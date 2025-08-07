import { chromium } from 'playwright';
import { PythonShell } from 'python-shell';
import path from 'path';
import fs from 'fs';

const lotusPluginRoot = path.resolve(process.cwd(), 'plugins', 'Lotus-Plugin');
const tempDir = path.join(lotusPluginRoot, 'data', 'temp', 'captcha');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}
const gtJsPath = path.join(lotusPluginRoot, 'resources', 'gt.js');

function getHumanTrack(distance) {
  const track = [];
  let current = 0;
  let t = 0.2;
  let v = 0;
  while (current < distance) {
    let a = (current < distance * 0.7) ? Math.random() * 2 + 2 : -(Math.random() * 3 + 3);
    let s = v * t + 0.5 * a * (t * t);
    v = v + a * t;
    if (v < 0) v = 0;
    current += s;
    track.push(Math.round(s));
  }
  const sum = track.reduce((acc, val) => acc + val, 0);
  track.push(distance - sum);
  return track;
}

export class GeetestSolver {
    constructor(options = {}) {
        this.pythonCmd = options.pythonCmd || 'python';
        this.pythonScriptPath = path.join(lotusPluginRoot, 'model');
    }

    async solve(gt, challenge, uid) {
        logger.info(`[荷花插件][自动过码] [uid:${uid}] 开始处理滑块验证...`);
        const browser = await chromium.launch({ headless: true });
        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36'
        });
        await context.addInitScript(() => Object.defineProperty(navigator, 'webdriver', { get: () => undefined }));
        const page = await context.newPage();

        try {
            const htmlContent = `<!DOCTYPE html><html><head><title>Captcha Solver</title></head><body><div id="geetest-container"></div></body></html>`;
            await page.setContent(htmlContent);
            await page.addScriptTag({ path: gtJsPath });

            await page.evaluate(({ gt, challenge }) => {
                return new Promise((resolve, reject) => {
                    initGeetest({
                        gt, challenge,
                        offline: false,
                        product: 'popup',
                        width: '100%',
                    }, (captchaObj) => {
                        captchaObj.onSuccess(() => {
                            window.geetest_validate_result = captchaObj.getValidate();
                        });
                        captchaObj.onReady(() => {
                            resolve();
                        });
                        captchaObj.appendTo('#geetest-container');
                    });
                });
            }, { gt, challenge });

            await page.waitForSelector('.geetest_bg', { state: 'visible', timeout: 15000 });
            
            const bgElement = await page.$('.geetest_bg');
            const sliderElement = await page.$('.geetest_slider_button');
            const puzzleElement = await page.$('.geetest_slice');
            
            const bgPath = path.join(tempDir, `bg_${uid}_${Date.now()}.png`);
            const sliderPath = path.join(tempDir, `slider_${uid}_${Date.now()}.png`);

            await bgElement.screenshot({ path: bgPath });
            await puzzleElement.screenshot({ path: sliderPath });

            logger.info(`[荷花插件][自动过码] [uid:${uid}] 图片获取成功，调用 ddddocr 识别...`);
            
            const options = {
                mode: 'text',
                pythonPath: this.pythonCmd,
                pythonOptions: ['-u'],
                scriptPath: this.pythonScriptPath,
                args: [sliderPath, bgPath]
            };

            const results = await PythonShell.run('solve_slider.py', options);
            const distance = parseInt(results[0], 10) - 6;

            if (isNaN(distance) || distance < 1) {
                throw new Error('ddddocr 识别失败，未返回有效距离');
            }
            logger.info(`[荷花插件][自动过码] [uid:${uid}] 识别成功，距离: ${distance}px`);

            const box = await sliderElement.boundingBox();
            await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 10 });
            await page.mouse.down();
            const track = getHumanTrack(distance);
            for (const x of track) {
                await page.mouse.move(page.mouse._x + x, page.mouse._y + (Math.random() - 0.5));
                await page.waitForTimeout(Math.random() * 15 + 15);
            }
            await page.waitForTimeout(200);
            await page.mouse.up();
            logger.info(`[荷花插件][自动过码] [uid:${uid}] 模拟滑动完成。`);

            await page.waitForFunction(() => window.geetest_validate_result, { timeout: 10000 });
            const validate = await page.evaluate(() => window.geetest_validate_result);
            
            if (!validate || !validate.geetest_validate) {
                 throw new Error('滑动后未能获取到 validate 数据');
            }

            logger.mark(`[荷花插件][自动过码] [uid:${uid}] 成功获取 validate!`);
            await browser.close();
            fs.unlinkSync(bgPath);
            fs.unlinkSync(sliderPath);
            return { success: true, validate: validate };
            
        } catch (error) {
            logger.error(`[荷花插件][自动过码] [uid:${uid}] 自动化流程出错: ${error}`);
            await page.screenshot({ path: path.join(tempDir, `error_screenshot_${uid}.png`), fullPage: true });
            await browser.close();
            return { success: false, message: error.message };
        }
    }
}