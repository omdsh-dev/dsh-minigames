/**
 * 摩天楼 game definition: wires the Latin-square visibility logic into a
 * MiniGameInstance — click (or arrows) focuses a cell, click again / Space
 * cycles its height 1..n, digits type directly; givens stay locked. A grid
 * with one of each height per row/column matching all four clue strips
 * fires onScore with the time bonus and auto-advances 1.5s later.
 * Persisted level resumes where the player left off; P pauses (advance
 * timer freezes via the stored-remainder pattern); R restarts; [ ]
 * switches within reached levels.
 */
import type { MiniGameDefinition } from '../types.ts';
export declare const skyscrapersGame: MiniGameDefinition;
