/*
 * fis
 * http://fis.baidu.com/
 */

'use strict';

exports.name = 'release';
exports.desc = 'build and deploy your project';
exports.register = function(commander){
    
    function watch(opt){
        var root = fis.project.getProjectPath();
        var timer = -1;
        var safePathReg = /[\\\/][_\-.\s\w]+$/i;
        function listener(path){
            if(safePathReg.test(path)){
                clearTimeout(timer);
                if(LRServer){
                    clearTimeout(LRTimer);
                }
                timer = setTimeout(function(){
                    release(opt);
                }, 500);
            }
        }
        require('chokidar')
            .watch(root, {
                ignored : /[\/\\](?:output\b[^\/\\]*([\/\\]|$)|\.|fis-(?:conf|merge)\.json$)/i,
                persistent: true
            })
            .on('add', listener)
            .on('change', listener)
            .on('unlink', listener)
            .on('error', function(err){
                //fis.log.error(err);
            });
    }
    
    function time(fn){
        process.stdout.write('\n δ'.bold.yellow);
        var now = Date.now();
        fn();
        process.stdout.write((Date.now() - now + 'ms').green.bold);
        process.stdout.write('\n');
    }
    
    
    var LRServer, LRTimer;
    var lastModified = {};
    var collection = {};
    var deploy = require('./lib/deploy.js');
    
    function reload(){
        fis.util.map(LRServer.connections, function(id, connection){
            try {
                connection.send({
                    command: 'reload',
                    path: '*',
                    liveCSS: true
                });
                process.stdout.write('\n Ψ'.bold.yellow + '35729');
            } catch (e) {
                try {
                    connection.close();
                } catch (e) {}
                delete LRServer.connections[id];
            }
        });
    }
    
    function release(opt){
        var flag, cost, start = Date.now();
        process.stdout.write('\n Ω'.green.bold);
        opt.beforeEach = function(){
            flag = opt.debug ? '' : '.';
            cost = (new Date).getTime();
        };
        opt.afterEach = function(file){
            //cal compile time
            cost = (new Date).getTime() - cost;
            if(cost > 200){
                flag = flag.bold.yellow;
                fis.log.debug(file.realpath);
            } else if(cost < 100){
                flag = flag.grey;
            }
            var mtime = file.getMtime().getTime();
            //collect file to deploy
            if(file.release && lastModified[file.subpath] !== mtime){
                lastModified[file.subpath] = mtime;
                if(!collection[file.subpath]){
                    collection[file.subpath] = file;
                    process.stdout.write(flag);
                }
            }
        };
        
        opt.beforeCompile = function(file){
            collection[file.subpath] = file;
            process.stdout.write(flag);
        };
        
        try {
            //release
            fis.release(opt, function(ret){
                process.stdout.write(
                    (opt.debug ? '' : ' ') +
                    (Date.now() - start + 'ms').bold.green + '\n'
                );
                for(var item in collection){
                    if(collection.hasOwnProperty(item)){
                        if(opt.unique){
                            time(fis.compile.clean);
                        }
                        deploy(opt.dest, opt.md5, collection);
                        deploy(opt.dest, opt.md5, ret.pkg);
                        collection = {};
                        if(LRServer){
                            clearTimeout(LRTimer);
                            LRTimer = setTimeout(reload, 500);
                        }
                        return;
                    }
                }
            });
        } catch(e) {
            process.stdout.write('\n [ERROR] ' + (e.message || e) + '\n');
            if(opt.watch){
                process.stdout.write('\u0007');
            } else if(opt.debug) {
                throw e;
            } else {
                process.exit(1);
            }
        }
    }
    
    commander
        .option('-d, --dest <names>', 'release output destination', String, 'preview')
        .option('-r, --root <path>', 'set project root')
        .option('-w, --watch', 'monitor the changes of project')
        .option('-L, --live', 'automatically reload your browser')
        .option('-c, --clean', 'clean compile cache', Boolean, false)
        .option('-m, --md5 [level]', 'md5 release option', Number)
        .option('-D, --domains', 'add domain name', Boolean, false)
        .option('-l, --lint', 'with lint', Boolean, false)
        .option('-t, --test', 'with unit testing', Boolean, false)
        .option('-o, --optimize', 'with optimizing', Boolean, false)
        .option('-p, --pack', 'with package', Boolean, true)
        .option('-u, --unique', 'use unique compile caching', Boolean, false)
        .option('--debug', 'debug mode', Boolean, false)
        .action(function(){
            
            var options = arguments[arguments.length - 1];
            
            fis.log.throw = true;
            
            //configure log
            if(options.debug){
                fis.log.level = fis.log.L_ALL;
            }
            var root, conf, filename = fis.project.conf;
            if(options.root){
                root = fis.util.realpath(options.root);
                if(fis.util.isDir(root)){
                    if(fis.util.isFile(root + '/' + filename)){
                        conf = root + '/' + filename;
                    }
                    delete options.root;
                } else {
                    fis.log.error('invalid project root path [' + options.root + ']');
                }
            } else{
                //try to find fis-conf.js
                var cwd = root = fis.util.realpath(process.cwd()),
                    pos = cwd.length;
                do {
                    cwd  = cwd.substring(0, pos);
                    conf = cwd + '/' + filename;
                    if(fis.util.exists(conf)){
                        root = cwd;
                        break;
                    } else {
                        conf = false;
                        pos = cwd.lastIndexOf('/');
                    }
                } while(pos > 0);
            }
            
            //init project
            fis.project.setProjectRoot(root);
            
            process.title = 'fis ' + process.argv.splice(2).join(' ') + ' [ ' + root + ' ]';
            
            if(conf){
                var cache = fis.cache(conf, 'conf');
                if(!cache.revert()){
                    options.clean = true;
                    cache.save();
                }
                require(conf);
            } else {
                fis.log.warning('missing ' + filename);
            }
            
            if(options.clean){
                time(function(){
                    fis.cache.clean('compile');
                });
            }
            delete options.clean;
            
            //domain, fuck EventEmitter
            if(options.domains){
                options.domain = true;
                delete options.domains;
            }
            
            if(options.live){
                var LiveReloadServer = require('livereload-server');
                LRServer = new LiveReloadServer({
                    id: 'com.baidu.fis',
                    name: 'fis-reload',
                    version : fis.cli.info.version,
                    protocols: {
                        monitoring: 7
                    }
                });
                LRServer.on('livereload.js', function(req, res) {
                    var script = fis.util.read(__dirname + '/vendor/livereload.js');
                    res.writeHead(200, {'Content-Length': script.length, 'Content-Type': 'text/javascript'});
                    res.end(script);
                });
                LRServer.listen(function(err) {
                    if (err) {
                        err.message = 'LiveReload server Listening failed: ' + err.message;
                        fis.log.error(err);
                    }
                    process.stdout.write('\n Ψ'.bold.yellow + '35729');
                });
                delete options.live;
            }
            
            switch (typeof options.md5){
                case 'undefined':
                    options.md5 = 0;
                    break;
                case 'boolean':
                    options.md5 = options.md5 ? 1 : 0;
                    break;
                default :
                    options.md5 = isNaN(options.md5) ? 0 : parseInt(options.md5);
            }
            //md5 > 0, force release hash file
            options.hash = options.md5 > 0;
            
            if(options.watch){
                watch(options);
            } else {
                release(options);
            }
        });
};