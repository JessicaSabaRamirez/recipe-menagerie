import json
import uuid
import os
from typing import List, Optional, Dict, Any
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Security, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from google.oauth2 import id_token
from google.auth.transport import requests as google_requests
from pydantic import BaseModel
import services

# --- SECURITY CONFIG ---
ALLOWED_EDITORS = [
    "jessicasabaramirez@gmail.com", "jessleahkirchner@gmail.com", "highlandparkmermaids@gmail.com",
    "osabaramirez@gmail.com", "stephjbee@gmail.com", "cactuslady55@gmail.com", "kirchnerwilliam07@gmail.com"
]
GOOGLE_CLIENT_ID = "964126115948-gkpjsged4sbd1mmfsrr0u15v0c9sg0s5.apps.googleusercontent.com"

security = HTTPBearer()

def verify_editor(credentials: HTTPAuthorizationCredentials = Security(security)):
    token = credentials.credentials
    try:
        # Verify the token with Google
        id_info = id_token.verify_oauth2_token(
            token, 
            google_requests.Request(), 
            GOOGLE_CLIENT_ID
        )

        email = id_info.get("email")
        if email not in ALLOWED_EDITORS:
            raise HTTPException(status_code=403, detail="You are not an authorized editor.")

        return email

    except ValueError:
        raise HTTPException(status_code=401, detail="Invalid token")

app = FastAPI()

# --- CORS CONFIGURATION ---
# allow_credentials is False to prevent local browser blocking
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- MODELS ---
class ShoppingRequest(BaseModel):
    title: str
    ingredients: List[str]

class UrlRequest(BaseModel):
    url: str

class StarRequest(BaseModel):
    starred: bool

# --- ENDPOINTS ---

@app.post("/analyze")
async def analyze_recipe_photo(file: UploadFile = File(...)):
    content = await file.read()
    recipe_json = services.extract_recipe_from_image(content, file.content_type)
    try:
        recipe_data = json.loads(recipe_json)
        return recipe_data
    except json.JSONDecodeError:
        raise HTTPException(status_code=500, detail="AI returned invalid JSON")

@app.post("/recipes", dependencies=[Depends(verify_editor)])
async def save_recipe(
    recipe: str = Form(...),
    file: UploadFile = File(None)
):
    # 1. Parse the JSON string back into a dictionary
    try:
        recipe_data = json.loads(recipe)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON in recipe field")

    # 2. Handle Image (if provided)
    if file:
        image_bytes = await file.read()
        
        # If the recipe doesn't have a title yet (e.g., direct upload), ask AI
        if not recipe_data.get("title"):
            extracted_json = services.extract_recipe_from_image(image_bytes, file.content_type)
            ai_data = json.loads(extracted_json)
            # Merge AI data, but let user data take precedence if it exists
            recipe_data = {**ai_data, **recipe_data}
        
        # Upload the image to Cloud Storage
        filename = f"images/{file.filename}" 
        public_url = services.upload_image_to_gcs(image_bytes, filename)
        recipe_data["original_image_url"] = public_url

    # 3. Save to Database
    saved_data = services.save_recipe_to_db(recipe_data)
    
    return saved_data

@app.get("/recipes")
def get_recipes():
    return services.fetch_all_recipes()

@app.delete("/recipes/{recipe_id}", dependencies=[Depends(verify_editor)])
def delete_recipe_endpoint(recipe_id: str):
    success = services.delete_recipe(recipe_id)
    if not success:
        raise HTTPException(status_code=404, detail="Recipe not found")
    return {"message": "Recipe deleted"}

@app.put("/recipes/{recipe_id}", dependencies=[Depends(verify_editor)])
def update_recipe_endpoint(recipe_id: str, update_data: Dict[str, Any]):
    success = services.update_recipe(recipe_id, update_data)
    if not success:
        raise HTTPException(status_code=404, detail="Recipe not found")
    return {"message": "Recipe updated successfully"}

@app.put("/recipes/{recipe_id}/star", dependencies=[Depends(verify_editor)])
def star_recipe(recipe_id: str, request: StarRequest):
    services.update_recipe(recipe_id, {"starred": request.starred})
    return {"status": "success"}

@app.post("/admin/extract-times", dependencies=[Depends(verify_editor)])
def extract_times_for_all():
    """One-time migration: use AI to estimate cook times for recipes that don't have them."""
    recipes = services.fetch_all_recipes()
    updated = 0
    skipped = 0
    failed = 0
    for recipe in recipes:
        if recipe.get("total_time") or recipe.get("prep_time"):
            skipped += 1
            continue
        times = services.extract_times_for_recipe(recipe)
        if times:
            services.update_recipe(recipe["id"], times)
            updated += 1
        else:
            failed += 1
    return {"updated": updated, "skipped": skipped, "failed": failed}

@app.post("/shopping-list", dependencies=[Depends(verify_editor)])
def add_to_shopping_list(request: ShoppingRequest):
    try:
        success = services.add_ingredients_to_tasks(request.title, request.ingredients)
        if not success:
             raise HTTPException(status_code=500, detail="Failed to add to Google Tasks")
        return {"status": "success"}
    except Exception as e:
        print(f"Task Error: {e}")
        raise HTTPException(status_code=500, detail="Failed to add to tasks")

@app.post("/import-url", dependencies=[Depends(verify_editor)])
async def import_recipe_from_url(request: UrlRequest):
    # 1. Scrape and Extract
    recipe_json = services.extract_recipe_from_url(request.url)

    if not recipe_json:
        raise HTTPException(status_code=400, detail="Could not extract recipe from URL")

    try:
        # 2. Parse and Save
        recipe_data = json.loads(recipe_json)

        # Add a flag so we know it came from the web
        if "source" not in recipe_data:
             recipe_data["source"] = {"type": "website", "url": request.url}

        saved_data = services.save_recipe_to_db(recipe_data)
        return saved_data

    except json.JSONDecodeError:
        raise HTTPException(status_code=500, detail="AI returned invalid JSON")

if __name__ == "__main__":
    import uvicorn
    # Use the PORT environment variable provided by Cloud Run, default to 8080
    port = int(os.environ.get("PORT", 8080)) 
    uvicorn.run(app, host="0.0.0.0", port=port)

@app.post("/recipes/{recipe_id}/image", dependencies=[Depends(verify_editor)])
async def upload_recipe_image(recipe_id: str, file: UploadFile = File(...)):
    """Uploads a new image for a specific recipe and updates the database."""
    
    # 1. Read the file
    image_bytes = await file.read()
    
    # 2. Upload to Google Cloud Storage
    # We create a unique name using the recipe ID to avoid collisions
    filename = f"recipe_images/{recipe_id}_{file.filename}"
    public_url = services.upload_image_to_gcs(image_bytes, filename)
    
    # 3. Update the database
    services.update_recipe(recipe_id, {"original_image_url": public_url})
    
    return {"url": public_url}

@app.delete("/recipes/{recipe_id}/image", dependencies=[Depends(verify_editor)])
def delete_recipe_image(recipe_id: str):
    """Removes the image URL from a recipe."""
    services.update_recipe(recipe_id, {"original_image_url": None})
    return {"status": "success"}

# --- SERVE FRONTEND (Must be last) ---
# Catch-all route: serves static asset files directly, and falls back to index.html
# for any unrecognised path. This is required for SPA client-side routing to work
# (e.g. someone opening /recipe/:id directly in their browser).
if os.path.exists("static"):
    app.mount("/assets", StaticFiles(directory="static/assets"), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        # Serve known static root files (manifest, icons, etc.)
        candidate = os.path.join("static", full_path)
        if full_path and os.path.isfile(candidate):
            return FileResponse(candidate)
        return FileResponse("static/index.html")