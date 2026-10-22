import os
from pathlib import Path
from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import List, Tuple

# Import RAG agent functions
from agent import (
    query_agent,
    build_vectorstore,
    append_to_archive,
    KB_DIR,
    CHROMA_DIR
)

app = FastAPI(title="Cybersecurity Assistant API")

# Global retriever state
retriever = None

@app.on_event("startup")
def startup_event():
    global retriever
    print("Initializing RAG Vector Store...")
    # Rebuild on start to ensure clean sync with the knowledge base
    retriever = build_vectorstore(rebuild=True)
    print("Vector Store ready.")

class ChatRequest(BaseModel):
    question: str
    history: List[Tuple[str, str]]

@app.post("/api/chat")
async def chat_endpoint(request: ChatRequest):
    global retriever
    if not request.question:
        raise HTTPException(status_code=400, detail="Question cannot be empty.")
    
    # Run the query
    answer, sources = query_agent(request.question, request.history, retriever)
    
    # Save to history archive
    append_to_archive(request.question, answer)
    
    return {
        "answer": answer,
        "sources": sources
    }

@app.get("/api/documents")
async def get_documents_endpoint():
    """Returns the list of documents currently inside knowledge_base/."""
    KB_DIR.mkdir(parents=True, exist_ok=True)
    docs = []
    for p in KB_DIR.glob("**/*"):
        if p.is_file() and p.suffix.lower() in {".md", ".txt"}:
            stats = p.stat()
            docs.append({
                "name": p.name,
                "path": str(p),
                "size": stats.st_size,
                "modified": stats.st_mtime
            })
    return docs

@app.post("/api/upload")
async def upload_endpoint(files: List[UploadFile] = File(...)):
    """Uploads text or markdown files and rebuilds the vector database."""
    global retriever
    KB_DIR.mkdir(parents=True, exist_ok=True)
    
    saved_files = []
    for file in files:
        suffix = Path(file.filename).suffix.lower()
        if suffix not in {".txt", ".md"}:
            raise HTTPException(
                status_code=400, 
                detail=f"Unsupported file type '{suffix}'. Only .txt and .md files are allowed."
            )
            
        file_path = KB_DIR / file.filename
        try:
            content = await file.read()
            # Write bytes to file in UTF-8
            file_path.write_bytes(content)
            saved_files.append(file.filename)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to save {file.filename}: {str(e)}")
            
    # Rebuild vectorstore to include new documents
    print(f"Re-indexing vector database for new files: {saved_files}...")
    retriever = build_vectorstore(rebuild=True)
    print("Re-indexing complete.")
    
    return {
        "status": "success",
        "uploaded": saved_files,
        "message": f"Successfully uploaded {len(saved_files)} files and re-indexed the knowledge base."
    }

# Mount static files. Note: This must be mounted last because it acts as a catch-all.
static_dir = Path("static")
static_dir.mkdir(parents=True, exist_ok=True)
app.mount("/", StaticFiles(directory="static", html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    # Run server on port 8000
    uvicorn.run("app:app", host="127.0.0.1", port=8000, reload=True)
