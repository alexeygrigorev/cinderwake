Review the actual Cinderwake interface images in this directory independently.
Read capture-manifest.json, then open EVERY referenced PNG with an image tool.
The manifest binds the images to a frozen runtime source fingerprint. Review is
limited to those frames: four screen sizes, three selected classes, and the
opening gameplay screen. Do not claim acceptance for other game states, saved
journeys, combat animation or audio. Do not implement changes.

For each image return PASS, FAIL or UNCERTAIN with its exact frame filename and
specific observations. Inspect these criteria independently:

1. Selection: Can a new player immediately identify how to start, which hero is
   selected, and where to change the hero? Read the actual button and class
   labels. Secondary world settings and import should be distinguishable from
   the primary action. Check clipping, overlaps and placement on each screen.
2. Gameplay: Read the current objective and identify the movement, attack,
   ability, health, journal/save entry, and sound controls. Check whether their
   surfaces and text look clickable/readable and whether they obscure central
   gameplay or overlap each other. Describe the next action from visible copy.
3. Scene context: Do visible barriers read as upright fences with posts/rails?
   Flag white debris/fringes around buildings, checkerboards, stray squares or
   floor patterns that could be confused with collidable fences. Judge only the
   visible objects; absence of a fence cannot establish its appearance.

Do not accept a frame merely because its data says PASS. Cite visible pixels.
If an object is too small or absent, record that limitation instead of guessing.
Write review.json with {sourceFingerprint, inspectedFrames:[filenames],
frames:[{file,verdict,observations:[strings],limitations:[strings]}],
overallVerdict, unresolved:[strings]}. Return a concise summary to the parent.
