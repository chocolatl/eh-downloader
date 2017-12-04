const fs = require('fs');
const path = require('path');
const http = require('http');
const {URL} = require('url');
const EventEmitter = require('events');

// const download = require('download');
const jsdom = require("jsdom");
const {JSDOM} = jsdom;
const request = require('request');


function downloadFile(url, path) {

    return new Promise(function(resolve, reject) {
        let stream          = fs.createWriteStream(path);
        let streamFinished  = false;
        let donwloadTimeout = 100000;

        // 此处的timeout为等待服务器响应的时间
        request.get(url, {}).on('error', function(err) {
            return reject(err);
        }).pipe(stream);
    
        stream.on('error', function(err) {
            return reject(err);
        });
    
        stream.on('finish', function() {
            streamFinished = true;
            return resolve();
        });

        // 到达等待时间下载未完成，销毁可写流并发出错误事件
        setTimeout(function() {
            streamFinished === false && stream.destroy(new Error('Download Timeout.'));
        }, donwloadTimeout);
    });
}

function requestHTML(url, userOptions) {

    return new Promise(function(resolve, reject) {
        let options = Object.assign({url: url, timeout: 12000}, userOptions);

        let rq = request(options, function(err, response, body) {

            if(err) return reject(err);

            if(response.statusCode !== 200) {
                return reject(new Error(`Response Error. HTTP Status Code: ${response.statusCode}.`));
            }

            return resolve(body);
        });

    });
}

function getAllImagePageLink(detailsPageURL) {

    // 防止URL带上页数的参数,以确保是详情页的第一页
    detailsPageURL = detailsPageURL.split('?')[0];

    return requestHTML(detailsPageURL).then(html => {

        let {window: {document}} = new JSDOM(html);

        let pageNavigationLinks = document.querySelector('.gtb').querySelectorAll('a');

            pageNavigationLinks = Array.from(pageNavigationLinks).map(el => el.href);

            pageNavigationLinks = pageNavigationLinks.length === 1 ? 
                                  pageNavigationLinks : 
                                  pageNavigationLinks.slice(0, -1);     // 去除最后一个链接（下一页箭头的链接）

            pageNavigationLinks = pageNavigationLinks.map(link => {
                
                return requestHTML(link).then(html => {

                    let {window: {document}} = new JSDOM(html);

                    let imagePageLinks = document.querySelectorAll('#gdt > .gdtm a');
                        imagePageLinks = Array.from(imagePageLinks).map(el => el.href);

                    return imagePageLinks;
                });
                
            });

        return Promise.all(pageNavigationLinks).then(results => {

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

        let reloadCode = /onclick=\"return nl\('(.*)'\)\"/.exec(document.getElementById('loadfail').outerHTML)[1];
        let reloadURL  = imagePageURL + (imagePageURL.indexOf('?') > -1 ? '&' : '?') + 'nl=' + reloadCode;

        return {
            imageURL, nextURL, reloadURL
        };

    });
}

function downloadIamge(imagePageURL, saveDir, fileName) {
    
    return getImagePageInfo(imagePageURL).then(({imageURL, reloadURL}) => {
        
        return downloadFile(imageURL, path.join(saveDir, fileName)).then(_ => {

            // console.log(`${fileName} Download Successful.`);
            
        }).catch(err => {

            // 还没有点击重试链接
            if(imagePageURL.includes('nl=') === false) {

                // 模拟点击"Click here if the image fails loading"链接，重新尝试下载当前图片
                return downloadIamge(reloadURL, saveDir, fileName);

            } else {
                throw new Error(`${fileName} Download Failed. ${err.message}`);
            }
        });
    });
}

function downloadAll(detailsPageURL, saveDir, threads = 3) {

    let evo = new EventEmitter();

    async function autoDownlaod(links) {

        let length = links.length, downloaded = 0;
        let indexWithLinks = [...links.entries()];
        let indexWithLinksGroup = [];

        while(indexWithLinks.length > 0) {

            let slice = indexWithLinks.splice(0, threads);
            indexWithLinksGroup.push(slice);
        }

        for(let es of indexWithLinksGroup) {

            let promises = es.map(e => {
                let index = e[0], url = e[1], fileName = index + '.jpg';
                return downloadIamge(url, saveDir, fileName).then(_ => {
                    evo.emit('download', fileName);
                    evo.emit('progress', ++downloaded, links.length);
                });
            });

            await Promise.all(promises);
        }
    }

    getAllImagePageLink(detailsPageURL).then(links => {
        return autoDownlaod(links);
    }).then(_ => {
        evo.emit('done');
    }).catch(err => {
        evo.emit('error', err);
    });

    return evo;
}

function downloadDoujinshi(detailsPageURL, saveDir, threads = undefined) {

    try {
        if(fs.existsSync(saveDir) === false) {
            fs.mkdirSync(saveDir);
        }
    } catch (err) {
        return Promise.reject(err);
    }

    return downloadAll(detailsPageURL, saveDir, threads);
}

module.exports = {
    downloadDoujinshi
}