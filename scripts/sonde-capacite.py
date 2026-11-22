import json
import os
import time
import urllib.error
import urllib.request

key = os.environ.get("INFERHUB_API_KEY", "")
MODELE = [
    "ag/gemini-4-carbon",
    "ag/claude-sonnet-4-6",
    "ag/gemini-4-argon",
    "ag/claude-sonnet-5-5",
    "ag/gemini-3.8-flash-high",
    "zai/glm-4.6v",
    "ag/claude-opus-4-6-thinking",
]

ua = {
    "content-type": "application/json",
    "authorization": "Bearer " + key,
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0",
}

for modele in MODELE:
    charge = {
        "model": modele,
        "messages": [{"role": "user", "content": "Answer exactly: OK"}],
        "max_tokens": 5,
    }
    t = time.time()
    try:
        r = urllib.request.urlopen(
            urllib.request.Request(
                "https://api.inferhub.dev/v1/chat/completions",
                data=json.dumps(charge).encode(),
                headers=ua,
                method="POST",
            ),
            timeout=90,
        )
        j = json.loads(r.read().decode())
        contenu = str(j.get("choices", [{}])[0].get("message", {}).get("content", ""))[:40]
        print("%-30s HTTP %s in %.1fs -> %r" % (modele, r.status, time.time() - t, contenu))
    except urllib.error.HTTPError as e:
        corps = e.read().decode()
        print("%-30s HTTP %s in %.1fs -> %s" % (modele, e.code, time.time() - t, corps[:90]))
    except Exception as e:
        print("%-30s FAILED %s" % (modele, type(e).__name__))
