/**
 * 数回 game definition: wires the island/sea logic into a
 * MiniGameInstance — click (or arrows + Space) toggles a cell between sea
 * (shaded) and undecided; numbered cells stay locked white. The board wins
 * when every island matches its number exactly, islands do not touch, the
 * sea is one connected region, and no 2×2 block is all sea. Generation on
 * big boards is solver-heavy, so puzzles are cached per display level for
 * the page lifetime (deterministic per level). H flashes one unfinished
 * island's solution cells (any hint forfeits the time bonus). Persisted
 * level resumes
 * where the player left off; P pauses (advance timer freezes via the
 * stored-remainder pattern); R restarts; [ ] switches within reached
 * levels.
 */
import type { MiniGameDefinition } from '../types.ts';
export declare const nurikabeGame: MiniGameDefinition;
