const fs = require('fs');
const path = require('path');
const http = require('http');
const {URL} = require('url');
const EventEmitter = require('events');

const {JSDOM} = require("jsdom");
const yaml = require('js-yaml');
const deepAssign = require('deep-assign');
const mkdirp = require('mkdirp');
const sanitize = require("sanitize-filename");

const USER_CONFIG  = yaml.load(fs.readFileSync('config.yml', 'utf8'));


function requestHTML(url, userOptions) {

    const requestHTML = require('./lib/request-html');

    userOptions = deepAssign({
        retries: USER_CONFIG['download']['retries'],
        headers: {
            'user-agent': USER_CONFIG['download']['userAgent']
        }
    }, userOptions);
    
    return requestHTML(url, userOptions);
}

function downloadFile(url, path, userOptions) {

    const downloadFile = require('./lib/download-file');

    userOptions = deepAssign({
        headers: {
            'user-agent': USER_CONFIG['download']['userAgent']
        }
    }, userOptions);

    return downloadFile(url, path, userOptions);
}

function cookieString(cookiesObj) {
    return Object.entries(cookiesObj).map(([k, v]) => `${k}=${v}`).join('; ');
}

function isLogin(cookiesObj) {
    return requestHTML('https://e-hentai.org/home.php', {headers: {
        cookie: cookieString(cookiesObj)
    }}).then(html => {
        return html.includes('Image Limits');   // 通过页面是否包含"Image Limits"字符串判断是否登录
    });
}

function getGalleryTitle(detailsPageURL) {

    // cookie: 'nw=1' 用来跳过某些画廊出现的 Content Warning
    return requestHTML(detailsPageURL, {headers: {cookie: 'nw=1'}}).then(html => {

        let {window: {document}} = new JSDOM(html);

        return {
            ntitle: document.getElementById('gn').textContent,
            jtitle: document.getElementById('gj').textContent
        }

    });
}

function getAllImagePageLink(detailsPageURL) {

    // 防止URL带上页数的参数,以确保是详情页的第一页
    detailsPageURL = detailsPageURL.split('?')[0];

    // cookie: 'nw=1' 用来跳过某些画廊出现的 Content Warning
    return requestHTML(detailsPageURL, {headers: {cookie: 'nw=1'}}).then(html => {

        let {window: {document}} = new JSDOM(html);

        let pageNavLinks = document.querySelector('.gtb').querySelectorAll('a');

            pageNavLinks = Array.from(pageNavLinks).map(el => el.href);

            pageNavLinks = pageNavLinks.length === 1 ? 
                           pageNavLinks : pageNavLinks.slice(0, -1);     // 去除最后一个链接（下一页箭头的链接）

            pageNavLinks = pageNavLinks.map(getImageLinks);
            

        function getImageLinks(pageNavLink) {

            return requestHTML(pageNavLink, {headers: {cookie: 'nw=1'}}).then(html => {

                let {window: {document}} = new JSDOM(html);

                let imagePageLinks = document.querySelectorAll('#gdt > .gdtm a');

                return Array.from(imagePageLinks).map(el => el.href);
            });
        }

        return Promise.all(pageNavLinks).then(results => {

            let imagePages = [];

            results.forEach(arr => imagePages.push(...arr));

            return imagePages;
        });
    });
}

function getImagePageInfo(imagePageURL) {

    return requestHTML(imagePageURL).then(html => {

        let {window: {document}} = new JSDOM(html);
        
        let imageEl  = document.getElementById('img');
        let imageURL = imageEl.src;
        let nextURL  = imageEl.parentElement.href;

        let originalEl  = document.querySelector('#i7 a');
        let originalURL = originalEl && originalEl.href;    // originalURL可能不存在，这时值为 null

        let reloadCode = /onclick=\"return nl\('(.*)'\)\"/.exec(document.getElementById('loadfail').outerHTML)[1];
        let reloadURL  = imagePageURL + (imagePageURL.indexOf('?') > -1 ? '&' : '?') + 'nl=' + reloadCode;

        return {
            imageURL, nextURL, reloadURL, originalURL
        };

    });
}

async function downloadIamge(imagePageURL, saveDir, fileName, options = {}) {

    let lastErr  = null;

    let retries  = options.retries || 0,
        nlretry  = options.nlretry || false;

    let savePath = path.join(saveDir, fileName);

    let {imageURL, reloadURL} = await getImagePageInfo(imagePageURL);

    do {
        try {

            await downloadFile(imageURL, savePath);

        } catch (err) {

            lastErr = err;

            // 等待1000ms
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // 重试
            continue;
        }

        // 没有捕捉到错误说明下载成功，跳出循环
        lastErr = null;
        break;

    } while(retries--);


    if(lastErr !== null && nlretry === true) {

        // 模拟点击"Click here if the image fails loading"链接，重新尝试下载当前图片
        let {imageURL} =  await getImagePageInfo(reloadURL);
        await downloadFile(imageURL, savePath);

    } else if(lastErr !== null) {

        throw lastErr;
    }
}


function downloadAll(indexedLinks, saveDir, threads = 3, downloadOptions) {

    let evo = new EventEmitter();

    let total = indexedLinks.length;
    let processed = 0;

    for(let i = 0; i < threads; i++) {
        downloadOne();
    }

    function downloadOne() {

        if(indexedLinks.length === 0) return;
        
        let [index, url] = indexedLinks.shift();
        let fileName = index + '.jpg';

        function handle() {

            evo.emit('progress', ++processed, total);

            downloadOne();

            if(processed === total) {
                evo.emit('done');
            }
        }

        downloadIamge(url, saveDir, fileName, downloadOptions).then(function() {

            evo.emit('download', {fileName, index, url});
            handle();

        }).catch(function(err) {

            evo.emit('fail', err, {fileName, index, url});
            handle();
        });
    }

    return evo;
}

async function downloadGallery(detailsPageURL, saveDir) {

    const LOGIN_COOKIES = USER_CONFIG['login'];
    let login = LOGIN_COOKIES['__cfduid'] && LOGIN_COOKIES['ipb_member_id'] && LOGIN_COOKIES['ipb_pass_hash'];

    if(login && await isLogin(LOGIN_COOKIES) === false) {
        throw new Error('Login Faild.');
    }


    if(fs.existsSync(saveDir) === true && fs.lstatSync(saveDir).isDirectory() === false) {
        throw new Error(saveDir + ' is not a directory.');
    }

    let {jtitle, ntitle} = await getGalleryTitle(detailsPageURL);

    let title = USER_CONFIG['download']['jtitle'] === true ? jtitle : ntitle;

    if(jtitle.trim() === '') title = ntitle;
    if(ntitle.trim() === '') title = jtitle;
    
    title = sanitize(title);
    if(title.trim() === '') throw new Error('Empty Title.');

    saveDir = path.join(saveDir, title);
    if(fs.existsSync(saveDir) === false) {
        mkdirp.sync(saveDir);
    }

    let links = await getAllImagePageLink(detailsPageURL);
    let threads = USER_CONFIG['download']['threads'];

    let event = downloadAll([...links.entries()], saveDir, threads, {
        retries: USER_CONFIG['download']['retries'],
        nlretry: USER_CONFIG['download']['nlretry']
    });

    return Promise.resolve(event);
}

module.exports = {
    downloadGallery
}