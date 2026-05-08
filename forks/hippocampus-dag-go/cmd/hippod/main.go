package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"

	"github.com/ecca-stack/hippocampus-dag/internal/dag"
)

func main() {
	d := dag.New()
	mux := http.NewServeMux()

	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte("ok"))
	})

	mux.HandleFunc("/dag/put", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			http.Error(w, "POST required", 405)
			return
		}
		var body struct {
			StackID    string      `json:"stackId"`
			Epoch      uint64      `json:"epoch"`
			Ciphertext dag.Cipher  `json:"ciphertext"`
			Links      []string    `json:"links"`
			Kind       string      `json:"kind"`
			Pinned     bool        `json:"pinned"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		n := &dag.Node{
			Ciphertext: body.Ciphertext, Links: body.Links, Epoch: body.Epoch,
			Kind: body.Kind, Pinned: body.Pinned, StackID: body.StackID,
		}
		cid := d.Put(n)
		_ = json.NewEncoder(w).Encode(map[string]string{"cid": cid})
	})

	mux.HandleFunc("/dag/get", func(w http.ResponseWriter, r *http.Request) {
		cid := r.URL.Query().Get("cid")
		n, ok := d.Get(cid)
		if !ok {
			http.Error(w, "not found", 404)
			return
		}
		_ = json.NewEncoder(w).Encode(n)
	})

	mux.HandleFunc("/pin/add", func(w http.ResponseWriter, r *http.Request) {
		cid := r.URL.Query().Get("cid")
		if err := d.Pin(cid); err != nil {
			http.Error(w, err.Error(), 404)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]bool{"ok": true})
	})

	// /pin/lease — extends a pin lease until the supplied epoch. Pin leases
	// are the storage-scarcity primitive: a node only bypasses the ±2 epoch
	// drift gate while its lease covers the caller's current epoch.
	mux.HandleFunc("/pin/lease", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			http.Error(w, "POST required", 405)
			return
		}
		var body struct {
			CID        string `json:"cid"`
			UntilEpoch uint64 `json:"untilEpoch"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		if err := d.Lease(body.CID, body.UntilEpoch); err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "untilEpoch": body.UntilEpoch})
	})

	// /pin/status — reports whether a pin lease is currently active relative
	// to a given epoch. Inspectors call this to verify that a party that
	// claims to be storing X is actually paying for it.
	mux.HandleFunc("/pin/status", func(w http.ResponseWriter, r *http.Request) {
		cid := r.URL.Query().Get("cid")
		var ep uint64
		if v := r.URL.Query().Get("epoch"); v != "" {
			_, _ = fmt.Sscanf(v, "%d", &ep)
		}
		active := d.LeaseActive(cid, ep)
		n, ok := d.Get(cid)
		var expiry uint64
		if ok {
			expiry = n.PinExpiry
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"cid": cid, "active": active, "untilEpoch": expiry,
		})
	})

	mux.HandleFunc("/dhf/recall", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			http.Error(w, "POST required", 405)
			return
		}
		var req dag.RecallReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		_ = json.NewEncoder(w).Encode(d.Recall(req))
	})

	mux.HandleFunc("/stat", func(w http.ResponseWriter, r *http.Request) {
		n, p, pr := d.Stat()
		_ = json.NewEncoder(w).Encode(map[string]int{"nodes": n, "pinned": p, "peers": pr})
	})

	addr := ":5001"
	log.Printf("[hippocampus-dag] listening %s", addr)
	if err := http.ListenAndServe(addr, mux); err != nil {
		log.Fatal(err)
	}
}
