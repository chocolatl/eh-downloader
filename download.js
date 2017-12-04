const {downloadDoujinshi} = require('./index.js');

let durl  = process.argv[2];
let dpath = process.argv[3];

let ev = downloadDoujinshi(durl, dpath);

ev.on('download', fileName => {
    console.log(`${fileName} Download Successful.`);
});

ev.on('progress', (current, length) => {
    console.log(`Download Progress: ${current} / ${length}.`);
});

ev.on('done', _ => {
    console.log('done.');
});

ev.on('fail', (fileName, err) => {
    console.log(fileName, err);
});

ev.on('error', err => {
    console.error(err);
});