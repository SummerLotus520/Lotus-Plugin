import plugin from "../../../lib/plugins/plugin.js";
import loader from "../../../lib/plugins/loader.js";

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export class HhCustomExecute extends plugin {
	constructor() {
		super({
			name: "[荷花插件] 自定义执行",
			dsc: "通过指令模拟指定用户在指定场景执行命令",
			event: "message",
			priority: 0,
			rule: [
				{
					reg: "^#execute",
					fnc: "execute",
				},
			],
		});
	}

	async execute() {
		if (!this.e.isMaster) {
			return false;
		}

		const bot = this.e.bot || Bot;
		if (!bot) return;

		let options = this.parseArgs();
		if (options.error) {
			await this.reply(`[荷花插件] 自定义执行\n${options.error}`, true);
			return;
		}

		if (options.in === 'here') {
			if (this.e.isGroup) {
				options.in = this.e.group_id;
			} else {
				await this.reply("[荷花插件] 自定义执行\n错误：`here` 关键字只能在群聊中使用。", true);
				return;
			}
		}

		const tasks = await this.generateTasks(options);
		if (!tasks || tasks.length === 0) {
			await this.reply("[荷花插件] 自定义执行\n未能生成任何有效任务，请检查 `in` 和 `as` 参数是否正确。", true);
			return;
		}

		if (!options.hold) {
			await this.reply(`[荷花插件] 自定义执行\n准备就绪，即将执行 ${tasks.length} 个任务...`, true);
		} else {
			await this.reply(`[荷花插件] 自定义执行\n静默模式启动，将执行 ${tasks.length} 个任务并拦截所有输出。`, true);
		}


		let successCount = 0;
		for (let i = 0; i < tasks.length; i++) {
			const task = tasks[i];
			const success = await this.performSingleExecution(task, options);
			if (success) successCount++;

			if (tasks.length > 1 && i < tasks.length - 1) {
				await sleep(options.gap * 1000);
			}
		}

		if (tasks.length > 0 && !options.hold) {
			await sleep(options.gap * 1000);
		}

		await this.reply(`[荷花插件] 自定义执行\n执行完毕！共 ${tasks.length} 个任务，成功模拟 ${successCount} 个。`, true);

		return true;
	}

	parseArgs() {
		const args = {
			in: null,
			as: [],
			gap: 5,
			hold: false,
			run: "",
			error: ""
		};

		const raw_message = this.e.raw_message;
		const runIndex = raw_message.indexOf("run:");
		if (runIndex === -1) {
			args.error = "指令缺少 `run:` 参数！";
			return args;
		}

		args.run = raw_message.substring(runIndex + 4).trim();
		if (!args.run) {
			args.error = "`run:` 后必须有指令内容！";
			return args;
		}

		const optionsStr = raw_message.substring(0, runIndex);
		
		const asMatch = optionsStr.match(/\bas:((.|\s)*?)(?=\s(in:|gap:|hold:|run:)|$)/);
		if (asMatch) {
			const asValue = asMatch[1].trim();
			if (asValue.includes('@a')) {
				args.as = '@a';
			} else {
				let collectedQQ = [];
				this.e.message.forEach(seg => {
					if (seg.type === 'at' && asValue.includes(`qq=${seg.qq}`)) {
						collectedQQ.push(Number(seg.qq));
					}
				});
				const textPart = asValue.replace(/\[CQ:at,qq=\d+\]/g, '').trim();
				const qqList = textPart.split(/[,，\s]+/).map(s => s.trim()).filter(Boolean).map(Number);
				collectedQQ.push(...qqList);
				
				args.as = [...new Set(collectedQQ.filter(id => !isNaN(id)))];
			}
		}

		const inMatch = optionsStr.match(/\bin:((@s|@e|here|\d+))/);
		const gapMatch = optionsStr.match(/\bgap:(\d+)/);
		const holdMatch = optionsStr.match(/\bhold:(true|false)/);

		if (inMatch) args.in = inMatch[1];
		if (gapMatch) args.gap = Math.max(5, parseInt(gapMatch[1]));
		if (holdMatch) args.hold = holdMatch[1] === 'true';

		if (!args.in || (args.as !== '@a' && args.as.length === 0)) {
			args.error = "指令缺少 `in:` 或 `as:` 参数，或未能解析到任何执行人！";
		}
		
		return args;
	}

	async generateTasks(options) {
		const bot = this.e.bot || Bot;
		let tasks = [];
		const botUin = this.e.self_id;

		const getGroupMembers = async (groupId) => {
			const group = bot.pickGroup(groupId);
			if (!group) return [];
			try {
				const memberMap = await group.getMemberMap();
				return Array.from(memberMap.keys());
			} catch (error) {
				logger.warn(`[荷花插件][自定义执行] 获取群 ${groupId} 成员列表失败: ${error}`);
				return [];
			}
		};

		let groupIds = [];
		if (options.in === '@e') {
			groupIds = Array.from(bot.gl.keys());
		} else if (options.in !== '@s') {
			groupIds.push(Number(options.in));
		}

		if (options.in === '@s') {
			if (options.as === '@a') return []; 
			(options.as || []).forEach(userId => {
				tasks.push({ userId, groupId: null });
			});
		} else {
			for (const groupId of groupIds) {
				if (options.as === '@a') {
					const members = await getGroupMembers(groupId);
					members.forEach(userId => {
						if (String(userId) !== String(botUin)) {
							tasks.push({ userId, groupId });
						}
					});
				} else {
					(options.as || []).forEach(userId => {
						tasks.push({ userId, groupId });
					});
				}
			}
		}
		return tasks;
	}

	async performSingleExecution(task, options) {
		const bot = this.e.bot || Bot;
		const { userId, groupId } = task;
		const { run: command, hold } = options;
		
		const new_e = {
			...this.e,
			user_id: userId,
			msg: command,
			raw_message: command,
			message: null,
		};
		
		if (groupId) {
			const group = bot.pickGroup(groupId);
			if (group) {
				new_e.group = group;
				new_e.group_id = group.group_id;
				new_e.member = group.pickMember(userId);
			}
		}

		if (hold) {
			new_e.reply = async (msg, quote = false) => {
				const location = groupId ? `群${groupId}` : `私聊${userId}`;
				logger.info(`[荷花插件][自定义执行][已拦截] 原定发往 ${location} 的一条消息。`);
				return { message_id: 'intercepted-by-hh-execute' };
			};
		}
		
		try {
			bot.em("message", new_e);
		} catch (err) {
			if (err instanceof TypeError && err.message.includes("not a function")) {
				loader.deal(new_e);
			} else {
				logger.error(`[荷花插件][自定义执行] 注入事件时发生未知错误: ${err}`);
				return false;
			}
		}
		return true;
	}
}