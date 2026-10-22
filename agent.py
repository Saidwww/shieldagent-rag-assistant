from pathlib import Path
from datetime import datetime
import shutil
from langchain_core.documents import Document
from langchain_core.prompts import ChatPromptTemplate
from langchain_ollama import OllamaLLM, OllamaEmbeddings
from langchain_chroma import Chroma

KB_DIR = Path("knowledge_base")
CHROMA_DIR = Path("chroma_db")
MODEL = "llama3.1"
EMBED_MODEL = "mxbai-embed-large"

LOG_FILE = Path("chat_history_archive.md")

SYSTEM_PROMPT = """You are a cybersecurity research assistant.
You answer only questions about IT security, privacy, data protection, breach history, threat actors, attack techniques, MITRE ATT&CK, malware, ransomware, vulnerabilities, incident response, and defensive analysis.
If the user asks how an attack or data leak worked, explain it at a high level for education and defense.
DO NOT provide instructions for committing crimes, evading detection, or abusing systems.
When you do not know, say so clearly.
Use the retrieved context first and mention the source naturally in the answer.
"""

def load_documents():
    docs = []
    KB_DIR.mkdir(parents=True, exist_ok=True)
    for p in KB_DIR.glob("**/*"):
        if p.suffix.lower() not in {".md", ".txt"}:
            continue
        try:
            content = p.read_text(encoding="utf-8").strip()
            if not content:
                continue
            docs.append(Document(page_content=content, metadata={"source": str(p)}))
        except Exception as e:
            print(f"Error loading file {p}: {e}")
    return docs

def build_vectorstore(rebuild=True):
    """Builds or rebuilds the Chroma vector store from knowledge_base/ documents."""
    if rebuild and CHROMA_DIR.exists():
        try:
            shutil.rmtree(CHROMA_DIR)
        except Exception as e:
            print(f"Warning: could not delete chroma directory: {e}")
            
    docs = load_documents()
    if not docs:
        print("No documents found in knowledge_base/. Vector store is empty.")
        return None

    try:
        embeddings = OllamaEmbeddings(model=EMBED_MODEL)
        vectorstore = Chroma(
            collection_name="security_knowledge",
            persist_directory=str(CHROMA_DIR),
            embedding_function=embeddings,
        )
        vectorstore.add_documents(docs)
        return vectorstore.as_retriever(search_kwargs={"k": 4})
    except Exception as e:
        print(f"Error building vectorstore: {e}")
        return None

def append_to_archive(question: str, answer: str):
    """Saves the conversation to a permanent Markdown log file on your Macbook."""
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    
    if not LOG_FILE.exists():
        LOG_FILE.write_text("# Cybersecurity Assistant Chat History Archive\n\n", encoding="utf-8")
        
    entry = (
        f"### 🗓️ Session Date: {timestamp}\n"
        f"**👤 Question:** {question}\n\n"
        f"**🤖 Answer:**\n{answer}\n"
        f"{'-'*40}\n\n"
    )
    
    try:
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(entry)
    except Exception as e:
        print(f"Error archiving chat: {e}")

def query_agent(question: str, history_list: list, retriever=None):
    """
    Runs the RAG model pipeline.
    history_list format: [("User", "hi"), ("Assistant", "hello")]
    Returns: (answer_string, list_of_unique_sources)
    """
    try:
        model = OllamaLLM(model=MODEL)
    except Exception as e:
        return f"Error loading Ollama model: {e}", []

    prompt = ChatPromptTemplate.from_template(
        SYSTEM_PROMPT + "\n\n"
        "Context:\n{context}\n\n"
        "Chat History:\n{history}\n\n"
        "Question: {question}\nAnswer:"
    )
    chain = prompt | model

    history_str = ""
    for role, text in history_list:
        history_str += f"{role}: {text}\n"

    docs = []
    if retriever:
        try:
            docs = retriever.invoke(question)
        except Exception as e:
            print(f"Error during retrieval: {e}")

    context = (
        "\n\n".join(
            f"SOURCE: {d.metadata.get('source', 'unknown')}\n{d.page_content}"
            for d in docs
        )
        if docs else "No relevant context found."
    )

    try:
        answer = chain.invoke({
            "context": context, 
            "history": history_str if history_str else "No prior conversation history.", 
            "question": question
        })
    except Exception as e:
        answer = f"Error generating answer: {e}. Please ensure Ollama is running (`ollama run {MODEL}`)."

    sources = []
    if docs:
        for d in docs:
            src = d.metadata.get("source", "unknown")
            sources.append({
                "source": Path(src).name if src != "unknown" else src,
                "path": src
            })
            
    # Deduplicate sources
    unique_sources = []
    seen = set()
    for s in sources:
        if s["path"] not in seen:
            seen.add(s["path"])
            unique_sources.append(s)

    return answer, unique_sources

def main():
    # Rebuild on start to ensure clean sync with knowledge_base
    retriever = build_vectorstore(rebuild=True)
    chat_history = []

    print('Security agent ready. Saving chats permanently to chat_history_archive.md.')
    print('Type a question or "exit".')

    while True:
        try:
            q = input("> ").strip()
        except KeyboardInterrupt:
            break
            
        if q.lower() in {"exit", "quit"}:
            break
            
        if not q:
            continue

        # Convert simple list format for query_agent
        formatted_history = []
        for role, text in chat_history:
            formatted_history.append((role, text))

        answer, sources = query_agent(q, formatted_history, retriever)
        
        print(answer)
        if sources:
            print("\nSources:")
            for s in sources:
                print(f"- {s['source']}")
        print()

        chat_history.append(("User", q))
        chat_history.append(("Assistant", answer))
        append_to_archive(q, answer)

if __name__ == "__main__":
    main()