const {downloadDoujinshi} = require('./lib/Downloader.js');

let durl  = process.argv[2];
let dpath = process.argv[3];

downloadDoujinshi(durl, dpath).then(_ => {
    console.info('Download Complete!');
}).catch(err => {
    console.error(err);
});