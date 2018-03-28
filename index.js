module.exports = function(USER_CONFIG = {}) {
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');

const {JSDOM} = require('jsdom');
const deepAssign = require('deep-assign');
const mkdirp = require('mkdirp');
const sanitize = require('sanitize-filename');
const cloneDeep = require('clone-deep');
const SocksProxyAgent = require('socks-proxy-agent');
const Qnext = require('qnext');

let DEFAULT_CONFIG = {
    download: {
        threads: 3,
        retries: 1,
        nlretry: true,
        original: false,
        jtitle: true,
        fileName: '{index.0}',
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

        // ntitle一定存在，jtitle可能为空字符串
        // jtitle不存在时返回 undefined
        return {
            ntitle: document.getElementById('gn').textContent,
            jtitle: document.getElementById('gj').textContent.trim() || undefined
        }

    });
}

async function getAllImagePageLink(detailsPageURL) {

    // 防止URL带上页数的参数,以确保是详情页的第一页
    detailsPageURL = detailsPageURL.split('?')[0];

    // cookie: 'nw=1' 用来跳过某些画廊出现的 Content Warning
    let {body: html} = await requestHTML(detailsPageURL, {headers: {Cookie: 'nw=1'}})
    let document = new JSDOM(html).window.document;

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

    async function getImageLinks(pageLink) {
        let {body: html} = await requestHTML(pageLink, {headers: {Cookie: 'nw=1'}});
        let document = new JSDOM(html).window.document;
        let imagePageLinks = document.querySelectorAll('#gdt > .gdtm a');

        return Array.from(imagePageLinks).map(el => el.href);
    }

    let results = await Promise.all(pages.map(getImageLinks));
    let imagePages = [];
    results.forEach(arr => imagePages.push(...arr));

    return imagePages;
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

        let imageInfoStr = document.querySelectorAll('#i2 > div')[1].textContent;
        let fileName = imageInfoStr.split(' :: ')[0];
        
        return {
            imageURL, nextURL, reloadURL, originalURL, fileName
        };

    });
}

async function downloadIamge(imagePageInfo, dirPath, fileName, options = {}) {

    // 深拷贝传入选项
    options = cloneDeep(options);

    let nlretry  = options.nlretry || false,
        original = options.original || false;

    delete options.nlretry;
    delete options.original;

    let savePath = path.join(dirPath, fileName);

    let {imageURL, reloadURL, originalURL} = imagePageInfo;

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

    let lastErr = null;
    try {
        await downloadFile(downloadURL, savePath, options);
    } catch (err) {
        lastErr = err;
    }

    // 当downloadOriginal为ture时也跳过使用"fails loading"重试的步骤，下面的重试步骤仅针对于下载非原图
    if(lastErr && nlretry === true && downloadOriginal === false) {

        // 模拟点击"Click here if the image fails loading"链接，重新尝试下载当前图片
        let {imageURL} =  await getImagePageInfo(reloadURL);
        await downloadFile(imageURL, savePath, options);

    } else if(lastErr !== null) {

        throw lastErr;
    }
}

function downloadAll(indexedLinks, dirPath, {jtitle, ntitle}, threads = 3, downloadOptions) {

    let qnext = new Qnext(threads);
    let evo = new EventEmitter();

    let length = indexedLinks.length;

    // 任务相关信息
    evo.length = length;    // 总长度

    // 传入空数组的情况
    if(length === 0) {
        // 在下一个Tick再触发事件，直接触发会在evo返回给调用者之前触发
        process.nextTick(_ => {
            try {
                evo.emit('done');
            } catch(err) {
                evo.emit('error', err);
            }
        });
    }

    let tasks = indexedLinks.map(([index, url]) => () => {
        return (async function() {
            let info = await getImagePageInfo(url);

            let filenameExtension = /\.[^.]*$/.exec(info.fileName)[0].trim();   // 获取原文件名的后缀，"a.b.gif" -> ".gif"
            let filenameNoExt = info.fileName.replace(new RegExp(filenameExtension + '$'), '');     // 没有后缀的原文件名

            // 解析图片保存的文件名
            let fileName = CONFIG.download.fileName
                .replace(/\{jtitle\}/g, jtitle)
                .replace(/\{ntitle\}/g, ntitle)
                .replace(/\{filename\}/g, filenameNoExt)
                .replace(/\{index\.0\}/g, index + 0)
                .replace(/\{index\.1\}/g, index + 1)
                .replace(/\{index\.0\.4\}/g, ('0000' + (index + 0)).substr(-4,4))
                .replace(/\{index\.1\.4\}/g, ('0000' + (index + 1)).substr(-4,4));

            fileName = sanitize(fileName) + filenameExtension;

            await downloadIamge(info, dirPath, fileName, downloadOptions);

            evo.emit('download', {fileName, index, url});

        })().catch(err => evo.emit('fail', err, {index, url}));  // 发生异常
    });

    for(let task of tasks) {
        qnext.add(task);
    }

    qnext.on('empty', function() {
        evo.emit('done');
    });

    return evo;
}

// 在saveDir路径下根据Gallery的标题创建目录，返回创建的目录名和路径
// 如果saveDir路径不存在时会被递归创建目录
function createGalleryDir(detailsPageURL, saveDir, title) {
    
    function isFilePath(path) {
        if(fs.existsSync(path) === true && fs.lstatSync(path).isDirectory() === false) {
            throw new Error(path + ' is not a directory.');
        }
    }
    
    isFilePath(saveDir);

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

// 获取所有图片页面的链接，并转换为[index, link]的形式，index为从0开始编号的数字，用于指定链接的顺序
// 可以传入range参数如：[0, 3, 4]，表示仅返回index为0, 3, 4的项：[[0, link0], [3, link3], [4, link4]]
function getImageIndexedLinks(detailsPageURL, range = undefined) {
    return getAllImagePageLink(detailsPageURL).then(links => {
        let indexedLinks = [...links.entries()];
        if(Array.isArray(range)) {
            return indexedLinks.filter(([index]) => range.includes(index));
        } else {
            return indexedLinks;
        }
    });
}

async function downloadGallery(detailsPageURL, saveDir, range = undefined) {

    if(FULL_LOGIN_FIELD === false && CONFIG['download']['original'] === true) {
        throw new Error('Can not download original because you are not logged in.');
    }

    if(FULL_LOGIN_FIELD === true && await isLoginSuccessful() === false) {
        throw new Error('Login Faild.');
    }

    let {ntitle, jtitle = ntitle} = await getGalleryTitle(detailsPageURL);  // jtitle不存在时赋值为ntitle
    let title = sanitize(CONFIG['download']['jtitle'] === true ? jtitle : ntitle) || 'untitled';

    let {dirName, dirPath} = createGalleryDir(detailsPageURL, saveDir, title);

    let threads = CONFIG['download']['threads'];

    let downloadOptions = {
        nlretry: CONFIG['download']['nlretry'],
        original: CONFIG['download']['original']
    }

    let event;

    if(CONFIG['download']['downloadLog'] === false) {

        let indexedLinks = await getImageIndexedLinks(detailsPageURL, range);
        event = downloadAll(indexedLinks, dirPath, {jtitle, ntitle}, threads, downloadOptions);

    } else {

        let downloadLogPath = path.join(dirPath, 'download.json');
    
        let records = {
            downloaded: [],
            failed: [],
            waiting: []
        }
    
        if(fs.existsSync(downloadLogPath) === true) {
            let rc = JSON.parse(fs.readFileSync(downloadLogPath));
            records.waiting.push(...rc.failed, ...rc.waiting);  // 将上次未下载和下载失败的项合并到未下载中
            records.downloaded.push(...rc.downloaded);
        } else {
            let indexedLinks = await getImageIndexedLinks(detailsPageURL, range);
            records.waiting.push(...indexedLinks);
        }
    
        let indexedLinks = records.waiting;
        event = downloadAll(indexedLinks, dirPath, {jtitle, ntitle}, threads, downloadOptions);
    
        function moveWaitingItemTo(to, info) {
            records[to].push([info.index, info.url]);
            records.waiting = records.waiting.filter(([index]) => index != info.index);   // 从等待下载列表中移除
            fs.writeFileSync(downloadLogPath, JSON.stringify(records));   // 保存记录
        }
    
        // error事件发生时，对应下载项既不会加入failed队列也不会加入downloaded队列，而是直接丢弃
        // 所以如果发生error事件，那么本次下载结果的正确性与完整性将无法得到保证
        event.on('fail', (err, info) => moveWaitingItemTo('failed', info));
        event.on('download', info => moveWaitingItemTo('downloaded', info));
    
        // 下载完成且错误队列为空，删除download.json
        event.on('done', function() {
            records.failed.length === 0 && fs.existsSync(downloadLogPath) && fs.unlinkSync(downloadLogPath);
        });
    }

    // 返回对象中添加下载目录路径以及目录名
    event.dirPath = dirPath;
    event.dirName = dirName;

    return event;
}

return downloadGallery;

// 文件顶部 module.exports = function(USER_CONFIG = {}) {
// ... 的闭合大括号
}