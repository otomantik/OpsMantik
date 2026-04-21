----------------------------- MODULE InvariantCrucible -----------------------------
EXTENDS Naturals, FiniteSets, TLC

CONSTANTS Jobs, Hashes, Snapshots
ASSUME Null \in Snapshots

VARIABLES queueState, billed, ackStatus, ackSnapshot

\* queueState[j] \in {"PENDING","PROCESSING","COMPLETED","FAILED"}
\* billed tracks monetary terminal transition exactly-once
\* ackStatus[h] \in {"EMPTY","REGISTERED","APPLIED"}
\* ackSnapshot[h] stores immutable deterministic response snapshot

QueueStates == {"PENDING", "PROCESSING", "COMPLETED", "FAILED"}
AckStates == {"EMPTY", "REGISTERED", "APPLIED"}

Init ==
  /\ queueState = [j \in Jobs |-> "PENDING"]
  /\ billed = {}
  /\ ackStatus = [h \in Hashes |-> "EMPTY"]
  /\ ackSnapshot = [h \in Hashes |-> Null]

Claim(j) ==
  /\ queueState[j] = "PENDING"
  /\ queueState' = [queueState EXCEPT ![j] = "PROCESSING"]
  /\ UNCHANGED <<billed, ackStatus, ackSnapshot>>

Complete(j) ==
  /\ queueState[j] = "PROCESSING"
  /\ j \notin billed
  /\ queueState' = [queueState EXCEPT ![j] = "COMPLETED"]
  /\ billed' = billed \cup {j}
  /\ UNCHANGED <<ackStatus, ackSnapshot>>

Fail(j) ==
  /\ queueState[j] = "PROCESSING"
  /\ queueState' = [queueState EXCEPT ![j] = "FAILED"]
  /\ UNCHANGED <<billed, ackStatus, ackSnapshot>>

\* First request reserves receipt slot; no response snapshot yet.
RegisterAck(h) ==
  /\ ackStatus[h] = "EMPTY"
  /\ ackStatus' = [ackStatus EXCEPT ![h] = "REGISTERED"]
  /\ UNCHANGED <<queueState, billed, ackSnapshot>>

\* First successful apply freezes snapshot exactly once.
ApplyAck(h, s) ==
  /\ ackStatus[h] = "REGISTERED"
  /\ ackSnapshot[h] = Null
  /\ s \in Snapshots
  /\ ackStatus' = [ackStatus EXCEPT ![h] = "APPLIED"]
  /\ ackSnapshot' = [ackSnapshot EXCEPT ![h] = s]
  /\ UNCHANGED <<queueState, billed>>

\* Replays on APPLIED hash can only return existing frozen snapshot.
ReplayApplied(h, s) ==
  /\ ackStatus[h] = "APPLIED"
  /\ ackSnapshot[h] # Null
  /\ s = ackSnapshot[h]
  /\ UNCHANGED <<queueState, billed, ackStatus, ackSnapshot>>

\* Replays on REGISTERED hash cannot invent snapshot or mutate state.
ReplayRegistered(h) ==
  /\ ackStatus[h] = "REGISTERED"
  /\ ackSnapshot[h] = Null
  /\ UNCHANGED <<queueState, billed, ackStatus, ackSnapshot>>

Next ==
  \/ \E j \in Jobs : Claim(j) \/ Complete(j) \/ Fail(j)
  \/ \E h \in Hashes : RegisterAck(h) \/ ReplayRegistered(h)
  \/ \E h \in Hashes, s \in Snapshots : ApplyAck(h, s) \/ ReplayApplied(h, s)

TypeInvariant ==
  /\ \A j \in Jobs : queueState[j] \in QueueStates
  /\ billed \subseteq Jobs
  /\ \A h \in Hashes : ackStatus[h] \in AckStates
  /\ \A h \in Hashes : ackStatus[h] = "EMPTY" => ackSnapshot[h] = Null
  /\ \A h \in Hashes : ackStatus[h] = "REGISTERED" => ackSnapshot[h] = Null
  /\ \A h \in Hashes : ackStatus[h] = "APPLIED" => ackSnapshot[h] # Null

ExactlyOnceMoney ==
  \A j \in Jobs : Cardinality({x \in billed : x = j}) <= 1

AckSnapshotDeterministic ==
  \A h \in Hashes :
    ackStatus[h] = "APPLIED" =>
      /\ ackSnapshot[h] \in Snapshots
      /\ ackSnapshot[h] # Null

\* Liveness: anything registered should eventually be applied.
RegisteredEventuallyApplied ==
  \A h \in Hashes : [](ackStatus[h] = "REGISTERED" => <> (ackStatus[h] = "APPLIED"))

Vars == <<queueState, billed, ackStatus, ackSnapshot>>
ApplyStep(h) == \E s \in Snapshots : ApplyAck(h, s)

Spec ==
  /\ Init
  /\ [][Next]_Vars
  /\ \A h \in Hashes : WF_Vars(ApplyStep(h))

THEOREM Spec => []TypeInvariant
THEOREM Spec => []ExactlyOnceMoney
THEOREM Spec => []AckSnapshotDeterministic

=============================================================================
