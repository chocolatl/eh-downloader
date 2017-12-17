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


function requestHTML(url, userOptions) {

    const requestHTML = require('./lib/request-html');

    userOptions = deepAssign({
        retries: USER_CONFIG['download']['retries'],
        headers: {
            'User-Agent': USER_CONFIG['download']['userAgent']
        }
    }, cloneDeep(userOptions));
    
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

function requestResponse(url, userOptions) {

    const requestResponse = require('./lib/request-response');

    userOptions = deepAssign({
        headers: {
            'User-Agent': USER_CONFIG['download']['userAgent']
        }
    }, cloneDeep(userOptions));

    if(USER_CONFIG['download']['proxyHTML'] === true) {
        userOptions.agent = new SocksProxyAgent(USER_CONFIG['download']['proxy']);
    }
    
    return requestResponse(url, userOptions);
}

function cookieString(cookiesObj) {
    return Object.entries(cookiesObj).map(([k, v]) => `${k}=${v}`).join('; ');
}

function isLoginSuccessful(cookiesObj) {
    return requestHTML('https://e-hentai.org/home.php', {headers: {
        Cookie: cookieString(cookiesObj)
    }}).then(html => {
        return html.includes('Image Limits');   // 通过home页面是否包含"Image Limits"字符串判断是否登录
    });
}

function getGalleryTitle(detailsPageURL) {

    // cookie: 'nw=1' 用来跳过某些画廊出现的 Content Warning
    return requestHTML(detailsPageURL, {headers: {Cookie: 'nw=1'}}).then(html => {

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
    return requestHTML(detailsPageURL, {headers: {Cookie: 'nw=1'}}).then(html => {

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

            return requestHTML(pageLink, {headers: {Cookie: 'nw=1'}}).then(html => {

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

        let response = await requestResponse(downloadURL, options);

        if(response.statusCode !== 302) {
            throw new Error('Status code is not 302 found.');
        }

        // 获得原图的下载地址而非E站的302跳转地址
        downloadURL = response.headers.location;
    }


    // 下载文件的地址并不是E站地址，所以不需要E站的登录Cookie信息
    // 所以下载文件使用去除了Cookie的配置选项以确保登录信息不泄露
    let noCookiesOptions = cloneDeep(options);
    delete noCookiesOptions.headers.cookie;
    delete noCookiesOptions.headers.Cookie;

    do {
        try {

            await downloadFile(downloadURL, savePath, noCookiesOptions);

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
        await downloadFile(imageURL, savePath, noCookiesOptions);

    } else if(lastErr !== null) {

        throw lastErr;
    }
}


function downloadAll(indexedLinks, saveDir, threads = 3, downloadOptions) {

    indexedLinks = cloneDeep(indexedLinks);

    let evo = new EventEmitter();

    let total = indexedLinks.length;
    let processed = 0;

    if(total === 0) {
        process.nextTick(_ => evo.emit('done'));
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

    const LOGIN_COOKIES = USER_CONFIG['login'];
    let fullLoginField = Boolean(LOGIN_COOKIES['__cfduid'] && LOGIN_COOKIES['ipb_member_id'] && LOGIN_COOKIES['ipb_pass_hash']);

    if(fullLoginField === false && USER_CONFIG['download']['original'] === true) {
        throw new Error('Can not download original because you are not logged in.');
    }

    if(fullLoginField === true && await isLoginSuccessful(LOGIN_COOKIES) === false) {
        throw new Error('Login Faild.');
    }

    if(fs.existsSync(saveDir) === true && fs.lstatSync(saveDir).isDirectory() === false) {
        throw new Error(saveDir + ' is not a directory.');
    }

    let {jtitle, ntitle} = await getGalleryTitle(detailsPageURL);

    let title = USER_CONFIG['download']['jtitle'] === true && jtitle.trim() !== '' ? jtitle : ntitle;
    
    title = sanitize(title);
    if(title.trim() === '') {
        throw new Error('Empty Title.');
    }

    saveDir = path.join(saveDir, title);
    if(fs.existsSync(saveDir) === false) {
        mkdirp.sync(saveDir);
    }

    let threads = USER_CONFIG['download']['threads'];

    let downloadOptions = {
        retries: USER_CONFIG['download']['retries'],
        nlretry: USER_CONFIG['download']['nlretry'],
        original: USER_CONFIG['download']['original'],
        headers: {}
    }

    if(fullLoginField) {
        downloadOptions.headers.Cookie = cookieString(LOGIN_COOKIES);
    }
    

    let downloadLogPath = path.join(saveDir, 'download.json');

    let indexedLinks = [];

    let records = {
        downloaded: [],
        failed: [],
        waiting: []
    }

    if(fs.existsSync(downloadLogPath) === true && USER_CONFIG['download']['downloadLog'] === true) {
        
        records = JSON.parse(fs.readFileSync(downloadLogPath));

        // 将上次未下载和下载失败的项合并到未下载中
        records.waiting = [...records.failed, ...records.waiting];
        records.failed  = [];

        indexedLinks    = records.waiting;

    } else {

        let links = await getAllImagePageLink(detailsPageURL);

        records.waiting = [...links.entries()];
        
        indexedLinks = records.waiting;
    }

    let event = downloadAll(indexedLinks, saveDir, threads, downloadOptions);

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