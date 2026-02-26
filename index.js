/**
 * poker-decision-engine — Poker Action Decision Engine
 *
 * Given a game state snapshot and an equity function, recommends the optimal action.
 * Protocol-agnostic: works with any GameState that exposes the standard interface.
 *
 * Usage:
 *   const { DecisionEngine, Action } = require('poker-decision-engine');
 *   const engine = new DecisionEngine({ aggression: 0.4 });
 *   const decision = engine.decide(gameState, equityFn);
 *
 * The equityFn signature: ({ holeCards, boardCards, numOpponents }) => number 0-1
 * Can use poker-hand-evaluator's winProbability or any custom implementation.
 */
'use strict';

const Action = { NONE: 0, CHECK: 1, CALL: 2, BET: 3, FOLD: 4, RAISE: 5, ALL_IN: 6 };
const ActionName = { 0: 'NONE', 1: 'CHECK', 2: 'CALL', 3: 'BET', 4: 'FOLD', 5: 'RAISE', 6: 'ALL_IN' };

function can(optAction, act) {
  return (optAction & (1 << act)) !== 0;
}

class DecisionEngine {
  /**
   * @param {object} opts
   * @param {number} [opts.aggression=0.35]
   * @param {number} [opts.vpip=0.25]
   * @param {number} [opts.pfr=0.18]
   * @param {object} [opts.evaluator]  — optional hand evaluator with evaluate7()
   */
  constructor(opts = {}) {
    this.aggression = opts.aggression ?? 0.35;
    this.vpip       = opts.vpip       ?? 0.25;
    this.pfr        = opts.pfr        ?? 0.18;
    this.evaluator  = opts.evaluator  ?? null;
  }

  /**
   * Decide the best action for the current game state.
   *
   * @param {object}   gameState  — must expose: isHeroTurn, currentAct, holeCardStrings,
   *                                boardCardStrings, totalPot, bb, activeSeatCount
   * @param {function} equityFn   — ({ holeCards, boardCards, numOpponents }) => number 0-1
   * @returns {{ action, coin, name, reason, equity, confidence, handName }}
   */
  decide(gameState, equityFn) {
    const blank = (reason) => ({ action: Action.NONE, coin: 0, name: 'WAIT', reason, equity: 0.5, confidence: 0, handName: null });

    if (!gameState.isHeroTurn) return blank('Not hero turn');
    const act = gameState.currentAct;
    if (!act) return blank('No action data');

    const { optAction, optCoin: callAmount, minBetCoin, maxBetCoin, deskCoin } = act;
    const hole  = gameState.holeCardStrings  || gameState.holeCards  || [];
    const board = gameState.boardCardStrings || gameState.boardCards || [];
    const totalPot = gameState.totalPot ?? 0;
    const bb = gameState.bb ?? 0;
    const activeSeatCount = gameState.activeSeatCount ?? gameState.activePlayers ?? 2;

    const numOpponents = Math.max(1, activeSeatCount - 1);

    const free     = can(optAction, Action.CHECK);
    const canCall  = can(optAction, Action.CALL);
    const canRaise = can(optAction, Action.RAISE);
    const canFold  = can(optAction, Action.FOLD);
    const canAllIn = can(optAction, Action.ALL_IN);

    let equity   = 0.5;
    let handName = null;
    try {
      if (equityFn && hole.length >= 2) {
        equity = equityFn({ holeCards: hole, boardCards: board, numOpponents });
        if (board.length >= 3 && this.evaluator && this.evaluator.evaluate7) {
          const result = this.evaluator.evaluate7([...hole, ...board]);
          if (result) handName = result.name;
        }
      }
    } catch (_) {}

    const pot   = totalPot || 1;
    const potOdds = callAmount > 0 ? callAmount / (pot + callAmount) : 0;
    const spr     = deskCoin / Math.max(1, pot);

    if (board.length === 0) {
      return this._preFlopDecide({ free, canCall, canRaise, canFold, canAllIn, callAmount, pot, deskCoin, minBetCoin, maxBetCoin, bb, numOpponents, equity, potOdds, spr });
    }
    return this._postFlopDecide({ free, canCall, canRaise, canFold, canAllIn, callAmount, pot, deskCoin, minBetCoin, maxBetCoin, equity, potOdds, spr, handName });
  }

  _preFlopDecide(o) {
    const { free, canCall, canRaise, canFold, callAmount, pot, deskCoin, minBetCoin, maxBetCoin, bb, equity, potOdds } = o;

    if (free) {
      if (equity > 0.72 && canRaise) {
        const raise = this._sizeBet(minBetCoin, pot, 2.5, deskCoin);
        return this._mk(Action.RAISE, raise, equity, `Strong preflop (${pct(equity)}%), raising`, 'Strong hand raise');
      }
      return this._mk(Action.CHECK, 0, equity, 'Free check preflop', 'Free check');
    }

    if (equity > 0.70) {
      if (canRaise) {
        const raise = this._sizeBet(callAmount * 3, pot, 3, deskCoin);
        return this._mk(Action.RAISE, raise, equity, `Premium hand 3-bet (${pct(equity)}%)`, '3-bet premium');
      }
      if (canCall) return this._mk(Action.CALL, callAmount, equity, `Calling premium (${pct(equity)}%)`, 'Call premium');
    }

    if (equity > this.vpip) {
      const minCallingEquity = potOdds * (1 + this.aggression);
      if (equity >= minCallingEquity) {
        if (canRaise && equity > 0.55 && Math.random() < this.pfr) {
          const raise = this._sizeBet(callAmount * 2.5, pot, 2.5, deskCoin);
          return this._mk(Action.RAISE, raise, equity, `PFR spot (${pct(equity)}% vs ${pct(potOdds)}% odds)`, 'Standard raise');
        }
        if (canCall) return this._mk(Action.CALL, callAmount, equity, `+EV call (${pct(equity)}% vs ${pct(potOdds)}% odds)`, 'Standard call');
      }
    }

    if (canFold) return this._mk(Action.FOLD, 0, equity, `Fold: weak hand (${pct(equity)}%), price too high`, 'Fold weak hand');
    if (canCall) return this._mk(Action.CALL, callAmount, equity, `Forced call`, 'Forced call');
    return this._mk(Action.CHECK, 0, equity, 'Default check', 'Default');
  }

  _postFlopDecide(o) {
    const { free, canCall, canRaise, canFold, callAmount, pot, deskCoin, minBetCoin, maxBetCoin, equity, potOdds, spr, handName } = o;

    if (equity > 0.65) {
      if (free) {
        const bet = this._sizeBet(minBetCoin, pot * 0.6, 0.6, deskCoin);
        return this._mk(Action.BET || Action.RAISE, bet, equity, `Value bet with ${handName || 'strong hand'} (${pct(equity)}%)`, handName || 'Strong made hand');
      }
      if (canRaise) {
        const raise = this._sizeBet(callAmount * 2, pot * 0.7, 0.7, deskCoin);
        return this._mk(Action.RAISE, raise, equity, `Raise ${handName || 'strong'} (${pct(equity)}%)`, handName || 'Value raise');
      }
      if (canCall) {
        return this._mk(Action.CALL, callAmount, equity, `Call with ${handName || 'strong'} (${pct(equity)}%)`, handName || 'Call strong');
      }
    }

    if (equity > 0.40) {
      if (free) return this._mk(Action.CHECK, 0, equity, `Check with ${handName || 'decent hand'} (${pct(equity)}%)`, handName || 'Check');
      if (equity > potOdds * 1.15 && canCall) {
        return this._mk(Action.CALL, callAmount, equity, `+EV call: ${pct(equity)}% > ${pct(potOdds)}% odds`, handName || 'Pot odds call');
      }
      if (canFold) return this._mk(Action.FOLD, 0, equity, `Fold: bad price (${pct(equity)}% vs ${pct(potOdds)}% odds)`, 'Bad price fold');
    }

    if (free) return this._mk(Action.CHECK, 0, equity, `Weak hand, checking free`, handName || 'Check weak');
    if (canFold) return this._mk(Action.FOLD, 0, equity, `Weak hand: ${handName || 'low equity'} (${pct(equity)}%)`, handName || 'Fold weak');
    if (canCall) return this._mk(Action.CALL, callAmount, equity, `Forced call`, 'Forced');
    return this._mk(Action.CHECK, 0, equity, 'Default', 'Default');
  }

  _sizeBet(base, potFraction, fraction, stack) {
    const amt = Math.max(base || 0, potFraction || 0);
    return Math.min(stack, Math.max(0, amt));
  }

  _mk(action, coin, equity, reason, handName) {
    const confidence = Math.abs(equity - 0.5) * 2;
    return {
      action,
      coin:       Math.round(coin * 100) / 100,
      name:       ActionName[action] || String(action),
      reason,
      equity,
      confidence: Math.max(0, Math.min(1, confidence)),
      handName:   handName || null,
    };
  }
}

function pct(v) { return (v * 100).toFixed(0); }

module.exports = { DecisionEngine, Action, ActionName };
