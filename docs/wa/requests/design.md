# Requests from `design`

## 1. Let `vm-ask.test.mjs` accept other packages' marked blocks after `vm:ask end`

`app/test/vm-ask.test.mjs` (the check "the stylesheet's part is between its markers, at the end (only other packages'
marked blocks may follow)") accepts only `/* vm:<name> start */ … /* vm:<name> end */` after `/* vm:ask end */`:

```js
/^\s*(\/\* vm:[a-z]+ start \*\/[\s\S]*?\/\* vm:[a-z]+ end \*\/\s*)*$/
```

WA.md puts `wa:design` and `wa:bulk` "at the end of styles.css", and a `wa:*` block there fails that check. `design`
placed its block **immediately before `/* vm:ask start */`** instead (the cascade is identical: nothing in the vm blocks
styles a `wa-*` class, and the WhatsApp section it overrides is far above). `wa:bulk` will meet the same check.

Suggested change (any package's marked block may follow, which is what the sentence already says):

```js
/^\s*(\/\* [a-z]+:[a-z0-9-]+ start \*\/[\s\S]*?\/\* [a-z]+:[a-z0-9-]+ end \*\/\s*)*$/
```

After it, `wa:design` can move to the end at the merge, or stay where it is — either is correct.
