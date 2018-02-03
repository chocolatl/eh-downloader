const fs = require('fs');
const yaml = require('js-yaml');
const USER_CONFIG = yaml.load(fs.readFileSync('config.yml', 'utf8'));
const downloadGallery = require('./index.js')(USER_CONFIG);

let durl  = process.argv[2];
let dpath = process.argv[3] || '.';
let drange = process.argv[4];

let range = undefined;
if(drange) {
    range = [];
    for(let s of drange.split(',')) {
        if(s.includes('-')) {
            let [l, r] = s.split('-');
            for(let i = +l; i <= +r; i++) {
                range.push(i);
            }
        } else {
            range.push(+s)
        }
    }
}

downloadGallery(durl, dpath, range).then(ev => {
    ev.on('download', info => {
        console.log(`${info.fileName} Download Successful.`);
    });
    
    ev.on('progress', (current, length) => {
        console.log(`Download Progress: ${current} / ${length}.`);
    });
    
    ev.on('done', _ => {
        console.log('done.');
    });
    
    ev.on('fail', (err, info) => {
        console.log(err, info);
    });
    
    ev.on('error', err => {
        console.error(err);
    });
}).catch(err => {
    console.error(err);
});