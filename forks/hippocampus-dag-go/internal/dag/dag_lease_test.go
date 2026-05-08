package dag

import (
	"testing"
)

// PinLease tests — the storage scarcity primitive.
//
// Pins are *leases*, not permanent reservations. A node only bypasses the
// ±2 epoch drift gate while its lease covers the caller's current epoch.
// Once the lease expires the node falls back into the drift window. This is
// what makes long-term storage genuinely scarce in the tripartite-game model
// (see contracts/src/TripartiteGame.sol and docs/pin_lease.md).

func TestLeaseExtendsUntilEpoch(t *testing.T) {
	d := New()
	n := &Node{
		Ciphertext: Cipher{IV: "aa", CT: "leased", V: 1},
		Epoch:      1,
		Kind:       "episodic",
		StackID:    "stack:human:1:abc",
	}
	cid := d.Put(n)
	if err := d.Lease(cid, 50); err != nil {
		t.Fatalf("lease failed: %v", err)
	}
	got, _ := d.Get(cid)
	if !got.Pinned {
		t.Fatal("lease should set Pinned")
	}
	if got.PinExpiry != 50 {
		t.Fatalf("expected PinExpiry=50, got %d", got.PinExpiry)
	}
}

func TestLeaseCanOnlyExtend(t *testing.T) {
	d := New()
	n := &Node{Epoch: 1, StackID: "s", Kind: "episodic"}
	cid := d.Put(n)
	if err := d.Lease(cid, 100); err != nil {
		t.Fatalf("first lease failed: %v", err)
	}
	// Trying to shorten — must reject (otherwise a party could retroactively
	// reduce observed storage usage).
	if err := d.Lease(cid, 50); err == nil {
		t.Fatal("expected lease to refuse shortening")
	}
	// Equal lease — must also reject (no-op is suspicious / pointless).
	if err := d.Lease(cid, 100); err == nil {
		t.Fatal("expected lease to refuse equal expiry")
	}
	// Strictly longer — accepted.
	if err := d.Lease(cid, 200); err != nil {
		t.Fatalf("extending lease failed: %v", err)
	}
	got, _ := d.Get(cid)
	if got.PinExpiry != 200 {
		t.Fatalf("expected PinExpiry=200, got %d", got.PinExpiry)
	}
}

func TestLeaseNotFound(t *testing.T) {
	d := New()
	if err := d.Lease("ecca://nope@0", 10); err == nil {
		t.Fatal("expected error for missing CID")
	}
}

func TestLeaseActiveDuringWindow(t *testing.T) {
	d := New()
	n := &Node{Epoch: 1, StackID: "s", Kind: "episodic"}
	cid := d.Put(n)
	_ = d.Lease(cid, 20)
	for _, ep := range []uint64{1, 5, 20} {
		if !d.LeaseActive(cid, ep) {
			t.Fatalf("expected lease active at epoch %d", ep)
		}
	}
}

func TestLeaseActiveExpiresAfterEpoch(t *testing.T) {
	d := New()
	n := &Node{Epoch: 1, StackID: "s", Kind: "episodic"}
	cid := d.Put(n)
	_ = d.Lease(cid, 10)
	if d.LeaseActive(cid, 11) {
		t.Fatal("lease must not be active past expiry")
	}
}

func TestLeaseInactiveForUnpinnedNode(t *testing.T) {
	d := New()
	n := &Node{Epoch: 1, StackID: "s", Kind: "episodic"}
	cid := d.Put(n)
	if d.LeaseActive(cid, 1) {
		t.Fatal("unpinned node must report inactive")
	}
}

func TestLeaseLegacyPinWithoutExpiry(t *testing.T) {
	// A node pinned via the old `Pin()` API has PinExpiry=0 — treat as
	// indefinite for backwards compatibility.
	d := New()
	n := &Node{Epoch: 1, StackID: "s", Kind: "episodic"}
	cid := d.Put(n)
	_ = d.Pin(cid)
	if !d.LeaseActive(cid, 999_999) {
		t.Fatal("legacy pin (PinExpiry=0) should be treated as indefinite")
	}
}

func TestRecallExpiredLeaseFallsBackToDriftGate(t *testing.T) {
	// A leased node should bypass the drift gate while the lease holds, but
	// once expired it must re-enter the ±2 epoch window check.
	d := New()
	n := &Node{
		Ciphertext: Cipher{IV: "aa", CT: "decayed", V: 1},
		Epoch:      1,
		Kind:       "episodic",
		StackID:    "stack:human:1:abc",
	}
	cid := d.Put(n)
	_ = d.Lease(cid, 5) // lease expires at epoch 5

	// Recall at epoch 5 — lease still valid, should retrieve despite drift=4.
	resp := d.Recall(RecallReq{
		RootCID:     cid,
		StackID:     "stack:human:1:abc",
		Epoch:       5,
		Depth:       4,
		MemoryToken: 100,
	})
	if len(resp.Fragments) != 1 {
		t.Fatalf("epoch=5 (lease valid): expected 1 fragment, got %d", len(resp.Fragments))
	}

	// Recall at epoch 100 — lease expired, drift=99, must be broken.
	resp = d.Recall(RecallReq{
		RootCID:     cid,
		StackID:     "stack:human:1:abc",
		Epoch:       100,
		Depth:       4,
		MemoryToken: 100,
	})
	if len(resp.Fragments) != 0 {
		t.Fatalf("epoch=100 (lease expired): expected 0 fragments, got %d", len(resp.Fragments))
	}
	if len(resp.Broken) != 1 {
		t.Fatalf("epoch=100 (lease expired): expected 1 broken, got %d", len(resp.Broken))
	}
}

func TestRecallActiveLeaseSurvivesDriftAndDepth(t *testing.T) {
	// Two-node DAG where the leaf is leased far into the future. Caller
	// recalls from a much later epoch with adequate memory token — both
	// nodes should be returned.
	d := New()
	leaf := &Node{
		Ciphertext: Cipher{IV: "aa", CT: "leaf", V: 1},
		Epoch:      1,
		Kind:       "episodic",
		StackID:    "stack:human:1:abc",
	}
	leafCid := d.Put(leaf)
	_ = d.Lease(leafCid, 1_000)

	root := &Node{
		Ciphertext: Cipher{IV: "bb", CT: "root", V: 1},
		Links:      []string{leafCid},
		Epoch:      999,
		Kind:       "episodic",
		StackID:    "stack:human:1:abc",
	}
	rootCid := d.Put(root)
	_ = d.Lease(rootCid, 1_000)

	resp := d.Recall(RecallReq{
		RootCID:     rootCid,
		StackID:     "stack:human:1:abc",
		Epoch:       999,
		Depth:       4,
		MemoryToken: 100,
	})
	if len(resp.Fragments) != 2 {
		t.Fatalf("expected 2 fragments under active lease, got %d (broken=%v)",
			len(resp.Fragments), resp.Broken)
	}
	if resp.Fidelity != 1.0 {
		t.Fatalf("expected fidelity 1.0, got %f", resp.Fidelity)
	}
}

func TestLeaseDoesNotAffectStackOrTokenGates(t *testing.T) {
	// Pin lease must not bypass the stack-mismatch or memory-token-depth gate.
	d := New()
	leaf := &Node{
		Ciphertext: Cipher{IV: "aa", CT: "leaf", V: 1},
		Epoch:      1,
		Kind:       "episodic",
		StackID:    "stack:human:OTHER:xyz",
	}
	leafCid := d.Put(leaf)
	_ = d.Lease(leafCid, 1_000)

	// Stack mismatch: still broken even with active lease.
	resp := d.Recall(RecallReq{
		RootCID:     leafCid,
		StackID:     "stack:human:1:abc",
		Epoch:       1,
		Depth:       4,
		MemoryToken: 100,
	})
	if len(resp.Fragments) != 0 {
		t.Fatal("lease must not bypass stack-mismatch gate")
	}
	if len(resp.Broken) != 1 {
		t.Fatalf("expected 1 broken (stack mismatch), got %d", len(resp.Broken))
	}
}
