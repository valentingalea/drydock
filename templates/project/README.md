# Drydock Project Template

Copy this directory's contents into a new game repository, then:

1. add Drydock as the `drydock/` git submodule;
2. create `game/index.html` and the declared `game/src/` runtime;
3. add any engine or other external component as a git submodule and declare its
   mappings in `shipping/drydock-project.json`;
4. replace the example identity, release, and channel `deploymentId` values;
5. initialize Git, commit the declarations, and run `npm run drydock:validate`.

The committed template contains no operational host root, public route, credential, or
generated artifact.
