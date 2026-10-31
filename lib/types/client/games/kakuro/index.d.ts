/**
 * 数和 Kakuro game definition: wires the segment-sum logic into a
 * MiniGameInstance — click (or arrows) moves the cursor onto a white cell,
 * digits 1-9 type directly, Space/Enter cycles 1..9 then empties, 0/Backspace
 * clears. Every segment filled 1-9 without repeats and summing to its clue
 * fires onScore with the time bonus and auto-advances 1.5s later.
 * Persisted level resumes where the player left off; P pauses (advance
 * timer freezes via the stored-remainder pattern); R restarts; [ ]
 * switches within reached levels.
 */
import type { MiniGameDefinition } from '../types.ts';
export declare const kakuroGame: MiniGameDefinition;
