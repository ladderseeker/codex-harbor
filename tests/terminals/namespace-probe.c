#define _GNU_SOURCE
#include <sched.h>
#include <sys/mount.h>
#include <errno.h>
#include <stdio.h>
#include <unistd.h>
#define DENIED(call) do { errno=0; if ((call)!=-1 || errno!=EPERM) { perror(#call); return 1; } } while(0)
int main(void) {
  if(getuid()!=10001) return 1;
  DENIED(unshare(CLONE_NEWUSER));
  DENIED(unshare(CLONE_NEWNS));
  DENIED(mount("none","/tmp","tmpfs",0,NULL));
  puts("PASS terminal user/mount namespace and mount denied");
  return 0;
}
