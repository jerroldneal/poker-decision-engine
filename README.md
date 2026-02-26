# poker-decision-engine

Poker action decision engine that recommends optimal actions given a game state and equity function. Protocol-agnostic — works with any game state source (protobuf, Cocos2d scene graph, or custom).

## Usage

### Node.js (CommonJS)

```javascript
const { DecisionEngine, Action } = require('poker-decision-engine');
const { winProbability } = require('poker-hand-evaluator');

const engine = new DecisionEngine({
  aggression: 0.4,   // 0 = passive, 1 = maniac
  vpip: 0.25,        // voluntarily put in pot frequency
  pfr: 0.18,         // preflop raise frequency
});

const decision = engine.decide(gameState, winProbability);
console.log(decision);
// { action: 5, coin: 600, name: 'RAISE', reason: '...', equity: 0.72, confidence: 0.44, handName: 'Full House' }
```

### Browser (inject)

```html
<script src="hand-evaluator.js"></script>
<script src="decision-engine.js"></script>
<script>
  var engine = new window.__PokerDecisionEngine.DecisionEngine();
  var decision = engine.decide(gameStateSnapshot, window.__PokerHandEvaluator.winProbability);
</script>
```

## Game State Interface

The `decide()` method expects a game state object with these properties:

| Property | Type | Description |
|----------|------|-------------|
| `isHeroTurn` | boolean | Whether it's the hero's turn |
| `currentAct` | object | `{ seatNum, optAction, optCoin, minBetCoin, maxBetCoin, deskCoin }` |
| `holeCardStrings` | string[] | Hero's hole cards, e.g. `['As', 'Kh']` |
| `boardCardStrings` | string[] | Community cards |
| `totalPot` | number | Total pot size |
| `bb` | number | Big blind amount |
| `activeSeatCount` | number | Number of active players |

## Action Enum

| Name | Value |
|------|-------|
| NONE | 0 |
| CHECK | 1 |
| CALL | 2 |
| BET | 3 |
| FOLD | 4 |
| RAISE | 5 |
| ALL_IN | 6 |

## License

MIT
