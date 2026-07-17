--gc:arc
--threads:on
--deepcopy:on
--d:useMalloc

if projectName() == "main":
  switch("out", thisDir() & "/podlrc")

when defined(macosx):
  switch("passL", "-framework CoreServices")
  switch("passL", "-L/opt/homebrew/lib -Wl,-rpath,/opt/homebrew/lib/")

--hint:"ConvFromXtoItselfNotNeeded:off"

when withDir(thisDir(), system.fileExists("nimble.paths")):
  include "nimble.paths"
