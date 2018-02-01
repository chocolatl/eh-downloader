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

let DEFAULT_CONFIG = {
    download: {
        threads: 3,
        retries: 1,
        nlretry: true,
        original: false,
        jtitle: true,
        downloadLog: true,
        proxy: '',
        proxyHTML: false,
        proxyFile: false,
        userAgent: ''
    },
    login: {
        __cfduid: '',
        ipb_member_id: '',
        ipb_pass_hash: '',
        igneous: ''
    }
};

let USER_CONFIG = yaml.load(fs.readFileSync('config.yml', 'utf8'));

// CONFIG
const CONFIG = deepAssign({}, DEFAULT_CONFIG, USER_CONFIG);

USER_CONFIG = DEFAULT_CONFIG = null;

// 判断三个登录必填字段是否存在
const FULL_LOGIN_FIELD = Boolean(CONFIG['login']['__cfduid'] && CONFIG['login']['ipb_member_id'] && CONFIG['login']['ipb_pass_hash']);

// 如果必填字段存在，将登录配置中的所有字段加入Cookie
const LOGIN_COOKIES_STR = FULL_LOGIN_FIELD ? cookieString(CONFIG['login']) : undefined;

function requestHTML(url, userOptions) {

    const requestHTML = require('./lib/request-html');

    userOptions = deepAssign({
        retries: CONFIG['download']['retries'],
        headers: {
            'User-Agent': CONFIG['download']['userAgent']
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

    if(CONFIG['download']['proxyHTML'] === true) {
        userOptions.agent = new SocksProxyAgent(CONFIG['download']['proxy']);
    }

    return requestHTML(url, userOptions);
}

function downloadFile(url, path, userOptions) {

    const downloadFile = require('./lib/download-file');

    userOptions = deepAssign({
        headers: {
            'User-Agent': CONFIG['download']['userAgent']
        }
    }, cloneDeep(userOptions));

    if(CONFIG['download']['proxyFile'] === true) {
        userOptions.agent = new SocksProxyAgent(CONFIG['download']['proxy']);
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

async function downloadIamge(imagePageURL, dirPath, fileName, options = {}) {

    let lastErr  = null;

    // 深拷贝传入选项
    options = cloneDeep(options);

    let retries  = options.retries || 0,
        nlretry  = options.nlretry || false,
        original = options.original || false;

    delete options.retries;
    delete options.nlretry;
    delete options.original;

    let savePath = path.join(dirPath, fileName);

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


function downloadAll(indexedLinks, dirPath, threads = 3, downloadOptions) {

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

        downloadIamge(url, dirPath, fileName, downloadOptions).then(function() {

            evo.emit('download', {fileName, index, url});
            handle();

        }).catch(function(err) {

            evo.emit('fail', err, {fileName, index, url});
            handle();
        });
    }

    return evo;
}

// 在saveDir路径下根据Gallery的标题创建目录，返回创建的目录名和路径
// 如果saveDir路径不存在时会被递归创建目录
async function createGalleryDir(detailsPageURL, saveDir) {
    
    function isFilePath(path) {
        if(fs.existsSync(path) === true && fs.lstatSync(path).isDirectory() === false) {
            throw new Error(path + ' is not a directory.');
        }
    }
    
    isFilePath(saveDir);

    let {jtitle, ntitle} = await getGalleryTitle(detailsPageURL);
    let title = sanitize(CONFIG['download']['jtitle'] === true && jtitle.trim() ? jtitle : ntitle) || 'untitled';

    saveDir = path.join(saveDir, title);

    isFilePath(saveDir);

    if(fs.existsSync(saveDir) === false) {
        mkdirp.sync(saveDir);
    }

    return {
        dirName: title,
        dirPath: saveDir
    }
}

async function downloadGallery(detailsPageURL, saveDir) {

    if(FULL_LOGIN_FIELD === false && CONFIG['download']['original'] === true) {
        throw new Error('Can not download original because you are not logged in.');
    }

    if(FULL_LOGIN_FIELD === true && await isLoginSuccessful() === false) {
        throw new Error('Login Faild.');
    }

    let {dirName, dirPath} = await createGalleryDir(detailsPageURL, saveDir);

    let threads = CONFIG['download']['threads'];

    let downloadOptions = {
        retries: CONFIG['download']['retries'],
        nlretry: CONFIG['download']['nlretry'],
        original: CONFIG['download']['original']
    }

    let downloadLogPath = path.join(dirPath, 'download.json');

    let records = {
        downloaded: [],
        failed: [],
        waiting: []
    }

    if(fs.existsSync(downloadLogPath) === true && CONFIG['download']['downloadLog'] === true) {
        let rc = JSON.parse(fs.readFileSync(downloadLogPath));
        records.waiting.push(...rc.failed, ...rc.waiting);  // 将上次未下载和下载失败的项合并到未下载中
        records.downloaded.push(...rc.downloaded);
    } else {
        let links = await getAllImagePageLink(detailsPageURL);
        records.waiting.push(...links.entries());
    }

    let indexedLinks = records.waiting;
    let event = downloadAll(indexedLinks, dirPath, threads, downloadOptions);

    // 返回对象中添加下载目录路径以及目录名
    event.dirPath = dirPath;
    event.dirName = dirName;

    function moveWaitingItemTo(to, info) {
        records[to].push([info.index, info.url]);
        records.waiting = records.waiting.filter(([index]) => index != info.index);   // 从等待下载列表中移除
        CONFIG['download']['downloadLog'] === true && fs.writeFileSync(downloadLogPath, JSON.stringify(records));   // 保存记录
    }

    event.on('fail', (err, info) => moveWaitingItemTo('failed', info));
    event.on('download', info => moveWaitingItemTo('downloaded', info));

    // 下载完成且错误队列为空，删除download.json
    event.on('done', function() {
        records.failed.length === 0 && fs.existsSync(downloadLogPath) && fs.unlinkSync(downloadLogPath);
    });

    return event;
}

module.exports = {
    downloadGallery
}