/**
 * 时间线 Timeline 游戏定义：把纯逻辑与渲染接成 {@link MiniGameInstance}。
 * 交互：点手牌选中 → 点时间轴空位插入（或直接拖拽到空位）；点击已放置
 * 卡再点另一张交换，点空白手牌区可收回；Enter 提交判定，R 重开本关
 * （同 seed 同题），P 暂停，？/Esc 开合帮助面板（任意阶段可用）。渲染走
 * dirty 按需模式 + 500ms 计时 tick，静态局面零重绘。onScore 在每次过关
 * 与全部通关时上报累计总分。
 */
import type { MiniGameDefinition } from '../types.ts';
export declare const timelineGame: MiniGameDefinition;
