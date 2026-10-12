#include "AuthorizationBridge.h"
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
OSStatus UsoviaExecuteAuthorized(AuthorizationRef authorization, const char *path, char *const *arguments) {
    return AuthorizationExecuteWithPrivileges(authorization, path, kAuthorizationFlagDefaults, arguments, NULL);
}
OSStatus UsoviaPrivilegedReference(AuthorizationRef *authorization) {
    return AuthorizationCopyPrivilegedReference(authorization, kAuthorizationFlagDefaults);
}
#pragma clang diagnostic pop
