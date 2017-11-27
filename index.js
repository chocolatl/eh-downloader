const fs = require('fs');
const path = require('path');
const http = require('http');
const {URL} = require('url');

const download = require('download');
const jsdom = require("jsdom");
const {JSDOM} = jsdom;


// TODO JSDOM.fromURL有些情况下会一直处于pending状态不返回resolve/reject，导致永久挂起
// 准备考虑不使用JSDOM.fromURL，使用其它方法获取HTML文本，再使用JSDOM解析


function getAllImagePageLink(detailsPageURL) {

    // 防止URL带上页数的参数,以确保是详情页的第一页
    detailsPageURL = detailsPageURL.split('?')[0];

    return JSDOM.fromURL(detailsPageURL).then(({window: {document}}) => {

        let pageNavigationLinks = document.querySelector('.gtb').querySelectorAll('a');

            pageNavigationLinks = Array.from(pageNavigationLinks).map(el => el.href);

            pageNavigationLinks = pageNavigationLinks.length === 1 ? 
                                  pageNavigationLinks : 
                                  pageNavigationLinks.slice(0, -1);     // 去除最后一个链接（下一页箭头的链接）

            pageNavigationLinks = pageNavigationLinks.map(link => {
                
                return JSDOM.fromURL(link).then(({window: {document}}) => {

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

    return JSDOM.fromURL(imagePageURL).then(({window: {document}}) => {
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
        
        return download(imageURL, saveDir, {retries: 0, filename: fileName}).then(_ => {

            console.log(`${fileName} Download Successful.`);
            
        }).catch(err => {
            
            // 还没有点击重试链接
            if(imagePageURL.includes('nl=') === false) {
                
                console.log(err);

                // 模拟点击"Click here if the image fails loading"链接，重新尝试下载当前图片
                return downloadIamge(reloadURL, saveDir, fileName);

            } else {
                throw new Error(`${fileName} Download Failed.`);
            }
        });
    });
}

function downloadAll(detailsPageURL, saveDir, threads = 3) {

    async function autoDownlaod(links) {

        let indexWithLinks = [...links.entries()];
        let indexWithLinksGroup = [];

        while(indexWithLinks.length > 0) {

            let slice = indexWithLinks.splice(0, threads);
            indexWithLinksGroup.push(slice);
        }

        for(let es of indexWithLinksGroup) {

            let promises = es.map(e => {
                let index = e[0], url = e[1];
                return downloadIamge(url, saveDir, index + '.jpg')
            });

            await Promise.all(promises);
        }
    }

    return getAllImagePageLink(detailsPageURL).then(links => {
        return autoDownlaod(links);
    });
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