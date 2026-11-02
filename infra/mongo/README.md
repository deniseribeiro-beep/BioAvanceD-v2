# Lab Mongo keyFile

compose.lab-rs.yml mounts `./infra/mongo/lab-keyfile` into the Mongo container
for a single-node replica set with auth (`rs0`).

Generate once on the lab host (do **not** commit the keyfile):

```bash
openssl rand -base64 756 > infra/mongo/lab-keyfile
chmod 400 infra/mongo/lab-keyfile
# Mongo runs as uid 999 in the official image:
chown 999:999 infra/mongo/lab-keyfile
```
