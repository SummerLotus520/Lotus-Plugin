import plugin from '../../../lib/plugins/plugin.js';
import loader from '../../../lib/plugins/loader.js';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class allDaily extends plugin {
  constructor() {
    super({
      name: '全部体力',
      dsc: '触发 #体力、*体力、%体力',
      event: 'message',
      priority: 10,
      rule: [
        {
          reg: '^(!体力|全部体力|#全部体力)$',
          fnc: 'sendAllDaily',
        },
      ],
    });
  }

  async sendAllDaily() {
    if (this.e._fromAllDaily) return false;

    const bot = this.e.bot || Bot;
    if (!bot || !this.e.msg) return;

    const cmds = ['#体力', '*体力', '%体力'];
    const delay = 5000; 

    for (let cmd of cmds) {
      const new_e = {
        ...this.e,
        msg: cmd,
        raw_message: cmd,
        message: null,
        _fromAllDaily: true,
      };

      try {
        if (loader.groupGlobalCD) delete loader.groupGlobalCD[this.e.group_id];
        if (loader.groupCD) delete loader.groupCD[this.e.group_id];
      } catch {}

      try {
        bot.em('message', new_e);
      } catch {
        loader.deal(new_e);
      }

      await sleep(delay);
    }

    return true;
  }
}