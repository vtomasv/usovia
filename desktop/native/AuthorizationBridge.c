#include "AuthorizationBridge.h"
#include <stdio.h>
#include <unistd.h>
#include <fcntl.h>
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
OSStatus UsoviaExecuteAuthorized(AuthorizationRef authorization, const char *path, char *const *arguments, int *channel) {
    *channel = -1;
    FILE *communications = NULL;
    OSStatus result = AuthorizationExecuteWithPrivileges(authorization, path, kAuthorizationFlagDefaults, arguments, &communications);
    if (result == errAuthorizationSuccess && communications) {
        *channel = fcntl(fileno(communications), F_DUPFD_CLOEXEC, 3);
        fclose(communications);
        if (*channel < 0) return errAuthorizationInternal;
    }
    return result;
}
OSStatus UsoviaPrivilegedReference(AuthorizationRef *authorization) {
    return AuthorizationCopyPrivilegedReference(authorization, kAuthorizationFlagDefaults);
}
#pragma clang diagnostic pop
