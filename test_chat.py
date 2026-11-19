import httpx
import json
import asyncio

async def test_chat():
    url = "http://localhost:8000/chat/stream"
    payload = {
        "messages": [{"role": "user", "content": "Hi"}],
        "model": "phi3:mini",
        "stream": True
    }
    
    print(f"Connecting to {url}...")
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            async with client.stream("POST", url, json=payload) as resp:
                print(f"Status: {resp.status_code}")
                async for line in resp.aiter_lines():
                    if line.startswith("data:"):
                        data = line[5:].strip()
                        if data == "[DONE]":
                            print("\n[Stream Done]")
                            break
                        try:
                            obj = json.loads(data)
                            if "token" in obj:
                                print(obj["token"], end="", flush=True)
                        except:
                            pass
    except Exception as e:
        print(f"\nError: {e}")

if __name__ == "__main__":
    asyncio.run(test_chat())
