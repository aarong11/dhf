FROM ethereum/client-go:v1.14.8

# Dev mode: instant mining, Cancun-compatible, no custom genesis needed.
# We use --dev to get a fully functional EVM with mcopy/PUSH0 support.
# The dev account is pre-funded; we fund our deployer via an init script.

COPY genesis/password.txt /genesis/password.txt

ENTRYPOINT ["/bin/sh", "-c"]
CMD ["exec geth --dev --dev.period 4 --datadir /data --http --http.addr 0.0.0.0 --http.port 8545 --http.api eth,net,web3,debug,txpool,personal,admin --http.corsdomain '*' --http.vhosts '*' --ws --ws.addr 0.0.0.0 --ws.port 8546 --ws.api eth,net,web3,debug --ws.origins '*' --nodiscover --maxpeers 0 --gcmode archive"]
