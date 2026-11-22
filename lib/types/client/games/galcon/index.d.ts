/**
 * 星域征服 Galcon 游戏定义：把纯逻辑接成 {@link MiniGameInstance}——
 * continuous 帧循环推进模拟与渲染。点击己方星球选中（再点该星=全选
 * 己方），点目标星球从所有选中星球各派 50% 兵力；空格=全选己方（局
 * 末=进入下一局）、R 重开整场（3 局积分清零）、P 暂停。得分经
 * onScore 上报（面板管理最高分）。
 */
import type { MiniGameDefinition } from '../types.ts';
/** 星域征服 Galcon：派兵攻占星球，扩张要快、留守要够，3 局积分定胜负。 */
export declare const galconGame: MiniGameDefinition;
