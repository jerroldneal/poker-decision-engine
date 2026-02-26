/**
 * poker-decision-engine (browser IIFE)
 *
 * Exposes window.__PokerDecisionEngine = { DecisionEngine, Action, ActionName }
 * Uses window.__PokerHandEvaluator if available for hand name resolution.
 *
 * Usage:
 *   var engine = new window.__PokerDecisionEngine.DecisionEngine({ aggression: 0.4 });
 *   var decision = engine.decide(gameStateSnapshot, equityFn);
 */
var __pokerDecisionEngineResult = (function () {
  'use strict';

  if (window.__PokerDecisionEngine) return 'already_installed';

  var Action = { NONE: 0, CHECK: 1, CALL: 2, BET: 3, FOLD: 4, RAISE: 5, ALL_IN: 6 };
  var ActionName = { 0: 'NONE', 1: 'CHECK', 2: 'CALL', 3: 'BET', 4: 'FOLD', 5: 'RAISE', 6: 'ALL_IN' };

  function can(optAction, act) { return (optAction & (1 << act)) !== 0; }
  function pct(v) { return (v * 100).toFixed(0); }

  function DecisionEngine(opts) {
    opts = opts || {};
    this.aggression = opts.aggression != null ? opts.aggression : 0.35;
    this.vpip       = opts.vpip       != null ? opts.vpip       : 0.25;
    this.pfr        = opts.pfr        != null ? opts.pfr        : 0.18;
    this.evaluator  = opts.evaluator  || (window.__PokerHandEvaluator || null);
  }

  DecisionEngine.prototype.decide = function (gameState, equityFn) {
    var blank = function (reason) { return { action: Action.NONE, coin: 0, name: 'WAIT', reason: reason, equity: 0.5, confidence: 0, handName: null }; };

    var isHeroTurn = gameState.isHeroTurn || gameState.getIsHeroTurn && gameState.getIsHeroTurn();
    if (!isHeroTurn) return blank('Not hero turn');
    var act = gameState.currentAct;
    if (!act) return blank('No action data');

    var optAction = act.optAction, callAmount = act.optCoin || 0, minBetCoin = act.minBetCoin || 0;
    var maxBetCoin = act.maxBetCoin || 0, deskCoin = act.deskCoin || 0;
    var hole  = gameState.holeCardStrings || gameState.holeCards || [];
    var board = gameState.boardCardStrings || gameState.boardCards || [];
    var totalPot = gameState.totalPot != null ? gameState.totalPot : (gameState.getTotalPot ? gameState.getTotalPot() : 0);
    var activeSeatCount = gameState.activeSeatCount != null ? gameState.activeSeatCount : (gameState.getActiveSeatCount ? gameState.getActiveSeatCount() : (gameState.activePlayers || 2));
    var numOpponents = Math.max(1, activeSeatCount - 1);

    var free = can(optAction, Action.CHECK), canCall = can(optAction, Action.CALL);
    var canRaise = can(optAction, Action.RAISE), canFold = can(optAction, Action.FOLD);

    var equity = 0.5, handName = null;
    try {
      if (equityFn && hole.length >= 2) {
        equity = equityFn({ holeCards: hole, boardCards: board, numOpponents: numOpponents });
        if (board.length >= 3 && this.evaluator && this.evaluator.evaluate7) {
          var result = this.evaluator.evaluate7([].concat(hole, board));
          if (result) handName = result.name;
        }
      }
    } catch (e) {}

    var pot = totalPot || 1;
    var potOdds = callAmount > 0 ? callAmount / (pot + callAmount) : 0;
    var self = this;

    if (board.length === 0) {
      // Pre-flop
      if (free) {
        if (equity > 0.72 && canRaise) return self._mk(Action.RAISE, Math.min(deskCoin, Math.max(minBetCoin, pot * 2.5)), equity, 'Strong preflop (' + pct(equity) + '%), raising', 'Strong hand raise');
        return self._mk(Action.CHECK, 0, equity, 'Free check preflop', 'Free check');
      }
      if (equity > 0.70) {
        if (canRaise) return self._mk(Action.RAISE, Math.min(deskCoin, callAmount * 3), equity, 'Premium hand 3-bet (' + pct(equity) + '%)', '3-bet premium');
        if (canCall) return self._mk(Action.CALL, callAmount, equity, 'Calling premium (' + pct(equity) + '%)', 'Call premium');
      }
      if (equity > self.vpip) {
        var minCallingEquity = potOdds * (1 + self.aggression);
        if (equity >= minCallingEquity) {
          if (canRaise && equity > 0.55 && Math.random() < self.pfr) return self._mk(Action.RAISE, Math.min(deskCoin, callAmount * 2.5), equity, 'PFR spot (' + pct(equity) + '% vs ' + pct(potOdds) + '% odds)', 'Standard raise');
          if (canCall) return self._mk(Action.CALL, callAmount, equity, '+EV call (' + pct(equity) + '% vs ' + pct(potOdds) + '% odds)', 'Standard call');
        }
      }
      if (canFold) return self._mk(Action.FOLD, 0, equity, 'Fold: weak hand (' + pct(equity) + '%), price too high', 'Fold weak hand');
      if (canCall) return self._mk(Action.CALL, callAmount, equity, 'Forced call', 'Forced call');
      return self._mk(Action.CHECK, 0, equity, 'Default check', 'Default');
    }

    // Post-flop
    if (equity > 0.65) {
      if (free) return self._mk(Action.RAISE, Math.min(deskCoin, Math.max(minBetCoin, pot * 0.6)), equity, 'Value bet with ' + (handName || 'strong hand') + ' (' + pct(equity) + '%)', handName || 'Strong made hand');
      if (canRaise) return self._mk(Action.RAISE, Math.min(deskCoin, Math.max(minBetCoin, callAmount * 2)), equity, 'Raise ' + (handName || 'strong') + ' (' + pct(equity) + '%)', handName || 'Value raise');
      if (canCall) return self._mk(Action.CALL, callAmount, equity, 'Call with ' + (handName || 'strong') + ' (' + pct(equity) + '%)', handName || 'Call strong');
    }
    if (equity > 0.40) {
      if (free) return self._mk(Action.CHECK, 0, equity, 'Check with ' + (handName || 'decent hand') + ' (' + pct(equity) + '%)', handName || 'Check');
      if (equity > potOdds * 1.15 && canCall) return self._mk(Action.CALL, callAmount, equity, '+EV call: ' + pct(equity) + '% > ' + pct(potOdds) + '% odds', handName || 'Pot odds call');
      if (canFold) return self._mk(Action.FOLD, 0, equity, 'Fold: bad price (' + pct(equity) + '% vs ' + pct(potOdds) + '% odds)', 'Bad price fold');
    }
    if (free) return self._mk(Action.CHECK, 0, equity, 'Weak hand, checking free', handName || 'Check weak');
    if (canFold) return self._mk(Action.FOLD, 0, equity, 'Weak hand: ' + (handName || 'low equity') + ' (' + pct(equity) + '%)', handName || 'Fold weak');
    if (canCall) return self._mk(Action.CALL, callAmount, equity, 'Forced call', 'Forced');
    return self._mk(Action.CHECK, 0, equity, 'Default', 'Default');
  };

  DecisionEngine.prototype._mk = function (action, coin, equity, reason, handName) {
    var confidence = Math.abs(equity - 0.5) * 2;
    return { action: action, coin: Math.round(coin * 100) / 100, name: ActionName[action] || String(action), reason: reason, equity: equity, confidence: Math.max(0, Math.min(1, confidence)), handName: handName || null };
  };

  window.__PokerDecisionEngine = { DecisionEngine: DecisionEngine, Action: Action, ActionName: ActionName };
  return 'ok';
})();
if (typeof module !== 'undefined') module.exports = __pokerDecisionEngineResult;
__pokerDecisionEngineResult;
