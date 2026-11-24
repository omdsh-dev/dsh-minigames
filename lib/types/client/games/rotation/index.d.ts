/**
 * 转盘密码游戏定义：把纯逻辑接成 {@link MiniGameInstance} —— 点击圆环
 * 或数字键选层、←/→ 旋转选中层、R 重开本关、P 暂停、H 或说明按钮开合
 * 帮助面板（任何阶段）、过关后 N 进入下一关。旋转补间动画期间持续重
 * 绘，静止时 dirty 按需。
 */
import type { MiniGameDefinition } from '../types.ts';
export declare const rotationGame: MiniGameDefinition;
