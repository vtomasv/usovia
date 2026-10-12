#include <Security/Authorization.h>
// Compatibility boundary for the session launcher. Apple deprecated these APIs;
// replace with signed SMAppService + authenticated XPC for managed distribution.
OSStatus UsoviaExecuteAuthorized(AuthorizationRef _Nonnull authorization, const char * _Nonnull path, char * _Nullable const * _Nonnull arguments, int * _Nonnull channel);
OSStatus UsoviaPrivilegedReference(AuthorizationRef _Nullable * _Nonnull authorization);
