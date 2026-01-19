import plugin from '../../../lib/plugins/plugin.js';

export class lotusDonate extends plugin {
    constructor() {
        super({
            name: '[荷花插件] 捐赠',
            dsc: '发送荷花插件捐赠链接',
            event: 'message',
            priority: 5000,
            rule: [
                {
                    reg: '(捐赠|donate|Donate)',
                    fnc: 'sendDonateLink'
                }
            ]
        });
    }

    async sendDonateLink(e) {
        await e.reply('荷花的捐赠链接：https://lotusshared.cn/2025/12/21/donate/\n感谢您对荷花运营的机器人及荷花插件的支持！');
        return true;
    }
}