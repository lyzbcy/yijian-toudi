#!/bin/bash
# All paths are argv/JSON values, never shell source. No elevation or quarantine removal.
set -euo pipefail
payload=$1
field() { /usr/bin/plutil -extract "$1" raw -o - "$payload"; }
root=$(field root); oldExe=$(field oldExe); userData=$(field userData)
version=$(field version); oldVersion=$(field oldVersion); oldPid=$(field pid)
nonce=$(field nonce); stage=$(field stage); backup=$(field backup); failed=$(field failed)
lock=$(field lock); attempt=$(field attempt); readyFile=$(field readyFile)
commitFile=$(field commitFile); abortFile=$(field abortFile); resultFile=$(field resultFile)
archive=$(field file); expectedHash=$(field sha256)
committed=0; movedOld=0; placedNew=0; finished=0; restored=false; restorationDeferred=false; message=mac-update-failed
json() {
 local destination=$1 status=$2 temp="$1.tmp-$$"
 /usr/bin/plutil -create xml1 "$temp"
 /usr/bin/plutil -insert status -string "$status" "$temp"
 /usr/bin/plutil -insert nonce -string "$nonce" "$temp"
 /usr/bin/plutil -insert version -string "$version" "$temp"
 /usr/bin/plutil -insert pid -integer "$$" "$temp"
 /usr/bin/plutil -insert root -string "$root" "$temp"
 /usr/bin/plutil -insert exe -string "$oldExe" "$temp"
 /usr/bin/plutil -insert backup -string "$backup" "$temp"
 /usr/bin/plutil -insert message -string "$message" "$temp"
 /usr/bin/plutil -insert restored -bool "$restored" "$temp"
 /usr/bin/plutil -insert restorationDeferred -bool "$restorationDeferred" "$temp"
 /usr/bin/plutil -convert json "$temp"
 /bin/mv "$temp" "$destination"
}
die() { message=$1; exit 1; }
ownedPath() { [[ "$1" == "$root.yjt-stage-$nonce" || "$1" == "$root.yjt-update-lock" ]]; }
bundleRunning() { local commands; commands=$(/bin/ps -ww -axo comm=) || return 2; /usr/bin/grep -F "$root/Contents/" <<< "$commands" >/dev/null; }
cleanup() {
 local status=$?
 trap - EXIT
 if [[ $finished -eq 0 ]]; then
  if [[ $movedOld -eq 1 ]]; then
   if bundleRunning; then
    restorationDeferred=true
   else
    if [[ $? -ne 1 ]]; then
     restorationDeferred=true
    else
     if [[ $placedNew -eq 1 && -d "$root" && ! -e "$failed" ]]; then /bin/mv "$root" "$failed" || true; fi
     if [[ ! -e "$root" && -d "$backup" ]]; then /bin/mv "$backup" "$root" && restored=true || true; fi
    fi
   fi
  fi
  json "$resultFile" failed || true
  if [[ $committed -eq 1 && ( $movedOld -eq 0 || "$restored" == true ) ]] && ! /bin/kill -0 "$oldPid" 2>/dev/null && [[ -x "$oldExe" ]]; then
   /usr/bin/open -n "$root" --args "--user-data-dir=$userData" || true
  fi
 fi
 if [[ -d "$stage" ]] && ownedPath "$stage"; then /bin/rm -rf -- "$stage"; fi
 if [[ -f "$lock/owner" && $(/bin/cat "$lock/owner") == "$nonce" ]] && ownedPath "$lock"; then /bin/rm -rf -- "$lock"; fi
 exit "$status"
}
[[ "$nonce" =~ ^[a-f0-9]{48}$ && "$oldPid" =~ ^[1-9][0-9]*$ ]] || exit 1
[[ "$oldExe" == "$root/Contents/MacOS/一键投递" ]] || exit 1
[[ "$stage" == "$root.yjt-stage-$nonce" && "$backup" == "$root.yjt-backup-$nonce" && "$failed" == "$root.yjt-failed-$nonce" && "$lock" == "$root.yjt-update-lock" ]] || exit 1
[[ "$root" == /Applications/*.app || "$root" == "$HOME"/Applications/*.app ]] || exit 1
[[ "$(/usr/bin/dirname "$root")" == /Applications || "$(/usr/bin/dirname "$root")" == "$HOME/Applications" ]] || exit 1
[[ "$userData" != "$root" && "$userData" != "$root/"* && ! -L "$root" && ! -L "$stage" && ! -e "$backup" && ! -e "$failed" ]] || exit 1
[[ -f "$lock/owner" && $(/bin/cat "$lock/owner") == "$nonce" ]] || exit 1
trap cleanup EXIT
verify() {
 local bundle=$1 wanted=$2
 [[ -d "$bundle" && ! -L "$bundle" ]] || return 1
 [[ $(/usr/bin/plutil -extract CFBundleIdentifier raw -o - "$bundle/Contents/Info.plist") == com.lyzbcy.yijiantoudi ]] || return 1
 [[ $(/usr/bin/plutil -extract CFBundleShortVersionString raw -o - "$bundle/Contents/Info.plist") == "$wanted" ]] || return 1
 /usr/bin/codesign --verify --deep --strict "$bundle"
}
verify "$root" "$oldVersion" || die old-bundle-changed
verify "$stage" "$version" || die staged-bundle-changed
[[ $(/usr/bin/shasum -a 256 "$archive" | /usr/bin/awk '{print $1}') == "$expectedHash" ]] || die update-package-changed
json "$readyFile" ready
for ((tick=0;tick<450;tick++)); do
 [[ ! -e "$abortFile" ]] || die update-aborted
 if [[ -e "$commitFile" ]]; then break; fi
 /bin/sleep 0.1
done
[[ -f "$commitFile" && $(/bin/cat "$commitFile") == "$nonce" && ! -e "$abortFile" ]] || die update-commit-timeout
committed=1
json "$attempt/commit-ack.json" committed
for ((tick=0;tick<600;tick++)); do
 if ! /bin/kill -0 "$oldPid" 2>/dev/null; then break; fi
 [[ ! -e "$abortFile" ]] || die update-aborted
 /bin/sleep 0.1
done
! /bin/kill -0 "$oldPid" 2>/dev/null || die old-process-did-not-exit
# Let Electron children finish. A second instance of this bundle prevents replacement.
for ((tick=0;tick<100;tick++)); do
 if bundleRunning; then :; elif [[ $? -eq 1 ]]; then break; else die cannot-inspect-installed-processes; fi
 /bin/sleep 0.1
done
if bundleRunning; then die another-installed-instance-is-running; elif [[ $? -ne 1 ]]; then die cannot-inspect-installed-processes; fi
[[ ! -e "$abortFile" ]] || die update-aborted
verify "$root" "$oldVersion" || die old-bundle-changed-before-replacement
verify "$stage" "$version" || die staged-bundle-changed-before-replacement
/bin/mv "$root" "$backup"; movedOld=1
/bin/mv "$stage" "$root"; placedNew=1
verify "$root" "$version" || die installed-bundle-verification-failed
json "$resultFile" installed
/usr/bin/open -n "$root" --args "--user-data-dir=$userData" || die updated-app-launch-failed
# A successful launcher call does not prove that the new application started.
restartDeadline=$((SECONDS+90))
while [[ $SECONDS -lt $restartDeadline ]]; do
 if [[ $(/usr/bin/plutil -extract nonce raw -o - "$resultFile" 2>/dev/null || true) == "$nonce" && $(/usr/bin/plutil -extract status raw -o - "$resultFile" 2>/dev/null || true) == restarted && $(/usr/bin/plutil -extract runningVersion raw -o - "$resultFile" 2>/dev/null || true) == "$version" ]]; then
  json "$attempt/completion.json" restarted
  finished=1
  break
 fi
 /bin/sleep 0.1
done
[[ $finished -eq 1 ]] || die updated-app-restart-not-confirmed
# The complete old bundle remains as a recovery copy; user data is never moved.
