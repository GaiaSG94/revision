#!/usr/bin/env python3
"""Deterministic union of conflicting logs, without a model.

A log (`CHANGELOG.md`) is written at the head: two entries added on each
side are not a disagreement, it is the same gesture. On 29/10, #215 was
rebased six times over `CHANGELOG.md` — an LLM call, a push and a CI per
rebase, until the hourly cap. Here, no call: when the base had nothing in a
conflict block, both sides are united; a block replacing a common line is
left to the model, it is a real disagreement.

Standard library only. Imported by `conflict_agent.py` (copied alone by
the sweep): the import is optional, its absence falls back to the old path.
"""

import os
import subprocess
import tempfile

# Pure-addition logs: united without a model (root or subfolder).
FICHIERS_AJOUTS = ("CHANGELOG.md", "CHANGELOG")
MAX_FILE_BYTES = 200_000


def log(message):
    print("union-journal: %s" % message, flush=True)


def journal_ajout_pur(path):
    """Is this the path of a pure-addition log (root or subfolder)?"""
    return any(path == nom or path.endswith("/" + nom) for nom in FICHIERS_AJOUTS)


def stages(path):
    """Three versions of a conflicting file: (base, ours, theirs), or None."""
    blobs = []
    for stage in (1, 2, 3):
        proc = subprocess.run(["git", "show", ":%d:%s" % (stage, path)],
                              capture_output=True, text=True, timeout=60)
        if proc.returncode != 0:
            return None
        blobs.append(proc.stdout)
    return tuple(blobs)


def _bloc(lignes, debut):
    """Cuts a diff3 conflict block from its opening marker.

    Returns (ours, base, theirs, next index), or None if a marker is missing.
    """
    i = debut + 1
    sections = []
    for marqueur in ("|||||||", "=======", ">>>>>>>"):
        contenu = []
        while i < len(lignes) and not lignes[i].startswith(marqueur):
            contenu.append(lignes[i])
            i += 1
        if i >= len(lignes):
            return None
        sections.append(contenu)
        i += 1
    return sections[0], sections[1], sections[2], i


def union_sans_perte(texte):
    """Unites both sides of conflicts where the base had nothing.

    A diff3 conflict block whose base section is empty is an addition from
    two sides. Uniting them loses no line. If ONE block replaces a common
    line, we return None: it is a real disagreement, the model decides.
    """
    lignes = texte.splitlines(keepends=True)
    sortie, i, blocs = [], 0, 0
    while i < len(lignes):
        if not lignes[i].startswith("<<<<<<<"):
            sortie.append(lignes[i])
            i += 1
            continue
        bloc = _bloc(lignes, i)
        if bloc is None:
            return None
        nous, base, eux, i = bloc
        if any(ligne.strip() for ligne in base):
            return None
        sortie.extend(nous)
        sortie.extend(eux)
        blocs += 1
    return "".join(sortie) if blocs else None


def _fusion(base, nous, eux):
    """Output of `git merge-file --diff3` on the three versions, or None."""
    temporaires = []
    try:
        for contenu in (nous, base, eux):
            with tempfile.NamedTemporaryFile("w", delete=False,
                                             suffix=".txt") as fh:
                fh.write(contenu)
                temporaires.append(fh.name)
        proc = subprocess.run(["git", "merge-file", "-p", "--diff3"]
                              + temporaires, capture_output=True, text=True,
                              timeout=60)
    finally:
        for nom in temporaires:
            try:
                os.unlink(nom)
            except OSError:
                pass
    if proc.returncode <= 0 or not proc.stdout:
        return None
    return proc.stdout


def resoudre_ajouts(path):
    """Resolves a pure-addition conflict without a model. Returns True if written+staged."""
    if not journal_ajout_pur(path):
        return False
    blobs = stages(path)
    if blobs is None:
        return False
    base, nous, eux = blobs
    if max(len(base), len(nous), len(eux)) > MAX_FILE_BYTES:
        return False
    fusion = _fusion(base, nous, eux)
    resolu = union_sans_perte(fusion) if fusion else None
    if resolu is None:
        return False
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(resolu)
    indexe = subprocess.run(["git", "add", "--", path], capture_output=True,
                            text=True, timeout=60)
    return indexe.returncode == 0


def resoudre_par_union(files):
    """Deterministic union on each pure-addition file; returns the resolved ones."""
    faits = []
    for path in files:
        if resoudre_ajouts(path):
            log("%s: additions on both sides — union without a model" % path)
            faits.append(path)
    return faits
