/**
 * 磁极谜题游戏定义：把纯逻辑接成 {@link MiniGameInstance}——dirty 按需
 * 重绘。点击磁格循环 空→+→−→中性→空（绝缘块不可点）；H 揭示一格与
 * 唯一解不符的极性（每关限 2 次，金点标记）；R 重开本关、P 暂停。全
 * 部磁格极性正确且行列计数精确吻合即过关，onScore 上报得分后 1.5 秒
 * 自动进入下一关（第 5 关过后循环回第 1 关重新生成同 seed 盘面）。
 */
import type { MiniGameDefinition } from '../types.ts';
export declare const magnetsGame: MiniGameDefinition;
