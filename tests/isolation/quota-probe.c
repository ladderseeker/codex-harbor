#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <string.h>
#include <unistd.h>
#include <fcntl.h>
#include <errno.h>
#include <sys/ioctl.h>
#include <sys/stat.h>
#include <linux/fs.h>
#define CHECK(x) do {if(!(x)){perror(#x);return 1;}}while(0)
int main(int argc,char**argv){
 CHECK(argc==3);const char *dir=argv[2];char path[512];snprintf(path,sizeof(path),"%s/quota-probe-owned",dir);
 if(!strcmp(argv[1],"readonly")){int fd=open(path,O_CREAT|O_WRONLY,0600);CHECK(fd<0&&(errno==EROFS||errno==EACCES));puts("PASS read-only mount denies runner write");return 0;}
 CHECK(getuid()==10001);int fd=open(path,O_CREAT|O_RDWR|O_EXCL,0600);CHECK(fd>=0);
 if(!strcmp(argv[1],"bytes")){char block[1048576]={0};int bounded=0;for(int i=0;i<128;i++){ssize_t n=write(fd,block,sizeof(block));if(n<0){CHECK(errno==ENOSPC);bounded=1;break;}}CHECK(bounded);CHECK(close(fd)==0);CHECK(unlink(path)==0);puts("PASS XFS project-quota ENOSPC hard-byte enforcement");return 0;}
 CHECK(close(fd)==0);CHECK(unlink(path)==0);
 if(!strcmp(argv[1],"inodes")){int count=0,bounded=0;for(;count<1000;count++){snprintf(path,sizeof(path),"%s/quota-inode-%d",dir,count);fd=open(path,O_CREAT|O_RDWR|O_EXCL,0600);if(fd<0){CHECK(errno==ENOSPC);bounded=1;break;}close(fd);}CHECK(bounded);for(int i=0;i<count;i++){snprintf(path,sizeof(path),"%s/quota-inode-%d",dir,i);CHECK(unlink(path)==0);}puts("PASS XFS project-quota ENOSPC hard-inode enforcement");return 0;}
 if(!strcmp(argv[1],"inheritance")){snprintf(path,sizeof(path),"%s/quota-child",dir);CHECK(mkdir(path,0700)==0);fd=open(path,O_RDONLY|O_DIRECTORY);CHECK(fd>=0);struct fsxattr attr;CHECK(ioctl(fd,FS_IOC_FSGETXATTR,&attr)==0);CHECK(attr.fsx_projid!=0&&(attr.fsx_xflags&FS_XFLAG_PROJINHERIT));attr.fsx_xflags&=~FS_XFLAG_PROJINHERIT;CHECK(ioctl(fd,FS_IOC_FSSETXATTR,&attr)<0&&errno==EPERM);attr.fsx_projid=0;CHECK(ioctl(fd,FS_IOC_FSSETXATTR,&attr)<0&&errno==EPERM);long flags=0;CHECK(ioctl(fd,FS_IOC_SETFLAGS,&flags)<0&&errno==EPERM);CHECK(ioctl(fd,0x40046602,&flags)<0&&errno==EPERM);close(fd);CHECK(rmdir(path)==0);puts("PASS inherited project ID; filesystem quota-escape ioctls denied");return 0;}
 return 1;
}
