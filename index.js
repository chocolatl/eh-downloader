const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');

const {JSDOM} = require("jsdom");
const yaml = require('js-yaml');
const deepAssign = require('deep-assign');
const mkdirp = require('mkdirp');
const sanitize = require("sanitize-filename");
const cloneDeep = require('clone-deep');
const SocksProxyAgent = require('socks-proxy-agent');

const USER_CONFIG  = yaml.load(fs.readFileSync('config.yml', 'utf8'));

// 判断三个登录必填字段是否存在
const FULL_LOGIN_FIELD  = Boolean(USER_CONFIG['login']['__cfduid'] && USER_CONFIG['login']['ipb_member_id'] && USER_CONFIG['login']['ipb_pass_hash']);

// 如果必填字段存在，将登录配置中的所有字段加入Cookie
const LOGIN_COOKIES_STR = FULL_LOGIN_FIELD ? cookieString(USER_CONFIG['login']) : undefined;

function requestHTML(url, userOptions) {

    const requestHTML = require('./lib/request-html');

    userOptions = deepAssign({
        retries: USER_CONFIG['download']['retries'],
        headers: {
            'User-Agent': USER_CONFIG['download']['userAgent']
        }
    }, cloneDeep(userOptions));
    
    // 登录字段配置完整且请求的域名是E站域名时，向Cookie头中添加登录Cookie
    // 注：e-hentai 和 exhentai 共用相同的登录Cookie
    // 注：下载图片的地址（IP）并不是E站地址，所以不需要E站的登录Cookie信息
    if(FULL_LOGIN_FIELD && (url.includes('e-hentai') || url.includes('exhentai'))) {
        userOptions.headers = userOptions.headers || {};
        if(!userOptions.headers.Cookie) {
            userOptions.headers.Cookie = LOGIN_COOKIES_STR;
        } else {
            userOptions.headers.Cookie = userOptions.headers.Cookie + '; ' + LOGIN_COOKIES_STR;
        }
    }

    if(USER_CONFIG['download']['proxyHTML'] === true) {
        userOptions.agent = new SocksProxyAgent(USER_CONFIG['download']['proxy']);
    }

    return requestHTML(url, userOptions);
}

function downloadFile(url, path, userOptions) {

    const downloadFile = require('./lib/download-file');

    userOptions = deepAssign({
        headers: {
            'User-Agent': USER_CONFIG['download']['userAgent']
        }
    }, cloneDeep(userOptions));

    if(USER_CONFIG['download']['proxyFile'] === true) {
        userOptions.agent = new SocksProxyAgent(USER_CONFIG['download']['proxy']);
    }

    return downloadFile(url, path, userOptions);
}

function cookieString(cookiesObj) {
    return Object.entries(cookiesObj).map(([k, v]) => `${k}=${v}`).join('; ');
}

function isLoginSuccessful() {
    return requestHTML('https://e-hentai.org/home.php').then(({body: html}) => {
        return html.includes('Image Limits');   // 通过home页面是否包含"Image Limits"字符串判断是否登录
    });
}

function getGalleryTitle(detailsPageURL) {

    // cookie: 'nw=1' 用来跳过某些画廊出现的 Content Warning
    return requestHTML(detailsPageURL, {headers: {Cookie: 'nw=1'}}).then(({body: html}) => {

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
    return requestHTML(detailsPageURL, {headers: {Cookie: 'nw=1'}}).then(({body: html}) => {

        let {window: {document}} = new JSDOM(html);

        // pageLinks存放分页导航器中的链接元素，里面可能有上一页、下一页的链接，而且当页面过多时，
        // 分页导航器会用"..."按钮来省略部分分页链接，所以不能直接使用分页导航器来取得所有分页的链接
        let pageLinks = document.querySelector('.ptt').querySelectorAll('a');
        let pages = [];
        
        if(pageLinks.length === 1) {

            // 只有一页的情况
            pages = [pageLinks[0].href];

        } else {

            // 获取最后一页链接（跳过数组最后一项，因为是下一页链接
            let lastPageLink = pageLinks[pageLinks.length - 2].href;
            let lastPage = Number.parseInt(/p=(\d+)/.exec(lastPageLink)[1], 10);

            for(let i = 0; i <= lastPage; i++) {
                pages.push(lastPageLink.replace(/p=(\d+)/, 'p=' + i));
            }
        }

        function getImageLinks(pageLink) {

            return requestHTML(pageLink, {headers: {Cookie: 'nw=1'}}).then(({body: html}) => {

                let {window: {document}} = new JSDOM(html);

                let imagePageLinks = document.querySelectorAll('#gdt > .gdtm a');

                return Array.from(imagePageLinks).map(el => el.href);
            });
        }

        return Promise.all(pages.map(getImageLinks)).then(results => {

            let imagePages = [];

            results.forEach(arr => imagePages.push(...arr));

            return imagePages;
        });
    });
}

function getImagePageInfo(imagePageURL) {

    return requestHTML(imagePageURL).then(({body: html}) => {

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

    // 深拷贝传入选项
    options = cloneDeep(options);

    let retries  = options.retries || 0,
        nlretry  = options.nlretry || false,
        original = options.original || false;

    delete options.retries;
    delete options.nlretry;
    delete options.original;

    let savePath = path.join(saveDir, fileName);

    let {imageURL, reloadURL, originalURL} = await getImagePageInfo(imagePageURL);

    // 判断下载原图还是压缩图
    let downloadOriginal = original === true && originalURL !== null;

    let downloadURL = downloadOriginal ? originalURL : imageURL;

    if(downloadURL === originalURL) {

        // 使用followRedirect阻止跳转，获取302指向的下载地址
        let {response} = await requestHTML(downloadURL, Object.assign(cloneDeep(options), {followRedirect: false}));

        if(response.statusCode !== 302) {
            throw new Error('Status code is not 302 found.');
        }

        // 获得原图的下载地址而非E站的302跳转地址
        downloadURL = response.headers.location;
    }

    do {
        try {

            await downloadFile(downloadURL, savePath, options);

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


    // 当downloadOriginal为ture时也跳过使用"fails loading"重试的步骤，下面的重试步骤仅针对于下载非原图
    if(lastErr !== null && nlretry === true && downloadOriginal === false) {

        // 模拟点击"Click here if the image fails loading"链接，重新尝试下载当前图片
        let {imageURL} =  await getImagePageInfo(reloadURL);
        await downloadFile(imageURL, savePath, options);

    } else if(lastErr !== null) {

        throw lastErr;
    }
}


function downloadAll(indexedLinks, saveDir, threads = 3, downloadOptions) {

    indexedLinks = cloneDeep(indexedLinks);

    let evo = new EventEmitter();

    let total = indexedLinks.length;
    let processed = 0;

    // 传入空数组的情况
    if(total === 0) {
        process.nextTick(_ => evo.emit('done'));    // 在下一个Tick再触发事件，直接触发会在evo返回给调用者之前触发
    }

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

    if(FULL_LOGIN_FIELD === false && USER_CONFIG['download']['original'] === true) {
        throw new Error('Can not download original because you are not logged in.');
    }

    if(FULL_LOGIN_FIELD === true && await isLoginSuccessful() === false) {
        throw new Error('Login Faild.');
    }

    if(fs.existsSync(saveDir) === true && fs.lstatSync(saveDir).isDirectory() === false) {
        throw new Error(saveDir + ' is not a directory.');
    }

    let {jtitle, ntitle} = await getGalleryTitle(detailsPageURL);

    let title = sanitize(USER_CONFIG['download']['jtitle'] === true && jtitle.trim() !== '' ? jtitle : ntitle) || 'untitled';

    saveDir = path.join(saveDir, title);
    if(fs.existsSync(saveDir) === true && fs.lstatSync(saveDir).isDirectory() === false) {
        throw new Error(saveDir + ' is not a directory.');
    } else if(fs.existsSync(saveDir) === false) {
        mkdirp.sync(saveDir);
    }

    let threads = USER_CONFIG['download']['threads'];

    let downloadOptions = {
        retries: USER_CONFIG['download']['retries'],
        nlretry: USER_CONFIG['download']['nlretry'],
        original: USER_CONFIG['download']['original'],
        headers: {}
    }

    let downloadLogPath = path.join(saveDir, 'download.json');

    let records = {
        downloaded: [],
        failed: [],
        waiting: []
    }

    if(fs.existsSync(downloadLogPath) === true && USER_CONFIG['download']['downloadLog'] === true) {

        let rc = JSON.parse(fs.readFileSync(downloadLogPath));

        // 将上次未下载和下载失败的项合并到未下载中
        records.waiting.push(...rc.failed, ...rc.waiting);
        records.downloaded.push(...rc.downloaded);

    } else {
        
        let links = await getAllImagePageLink(detailsPageURL);
        records.waiting.push(...links.entries());
    }

    let indexedLinks = records.waiting;
    let event = downloadAll(indexedLinks, saveDir, threads, downloadOptions);

    // 返回对象中添加下载目录路径以及目录名
    event.dirPath = saveDir;
    event.dirName = title;

    function saveLog() {
        fs.writeFileSync(downloadLogPath, JSON.stringify(records));
    }

    event.on('fail', (err, info) => {

        records.failed.push([info.index, info.url]);

        // 从等待下载列表中移除
        records.waiting = records.waiting.filter(([index, link]) => index != info.index);

        USER_CONFIG['download']['downloadLog'] === true && saveLog();
    });

    event.on('download', info => {

        records.downloaded.push([info.index, info.url]);

        // 从等待下载列表中移除
        records.waiting = records.waiting.filter(([index, link]) => index != info.index);
        
        USER_CONFIG['download']['downloadLog'] === true && saveLog();
    });

    event.on('done', function() {
        if(records.failed.length === 0) {
            fs.existsSync(downloadLogPath) && fs.unlinkSync(downloadLogPath);
        } else {
            USER_CONFIG['download']['downloadLog'] === true && saveLog();
        }
    });

    return event;
}

module.exports = {
    downloadGallery
}