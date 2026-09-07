# Deployment implementation

P009 implements the fixed administrator profile in D006. The Python administrator modules own installation, services and filesystem publication; the packaged TypeScript bridge owns database-aware validation and state transitions. Neither interface accepts project commands or executable restore hooks. Implementation and test evidence are in progress.
