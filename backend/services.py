import os
import json
import re
import requests
import firebase_admin
from firebase_admin import credentials, firestore, storage
from google.cloud import storage as gcs_storage
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
import google.generativeai as genai
from dotenv import load_dotenv

load_dotenv()

# --- CONFIGURATION ---
PROJECT_ID = "iron-asset-481618-q9"
BUCKET_NAME = "recipe-library-pictures"
REGION = "us-central1"
GEMINI_API_KEY = os.environ["GEMINI_API_KEY"]

# --- GOOGLE TASKS KEYS ---
TASKS_CLIENT_ID = os.environ["TASKS_CLIENT_ID"]
TASKS_CLIENT_SECRET = os.environ["TASKS_CLIENT_SECRET"]
TASKS_REFRESH_TOKEN = os.environ["TASKS_REFRESH_TOKEN"]

# Configure the AI with the Key
genai.configure(api_key=GEMINI_API_KEY)

# Initialize Firebase
if not firebase_admin._apps:
    cred = credentials.ApplicationDefault()
    firebase_admin.initialize_app(cred, {
        'projectId': PROJECT_ID,
    })

db = firestore.client()

# --- DATABASE FUNCTIONS ---

def save_recipe_to_db(recipe_data):
    """Saves a recipe to Firestore."""
    doc_ref = db.collection("recipes").document()
    recipe_data["id"] = doc_ref.id
    doc_ref.set(recipe_data)
    return recipe_data

def fetch_all_recipes():
    """Gets all recipes from Firestore."""
    recipes = []
    docs = db.collection("recipes").stream()
    for doc in docs:
        data = doc.to_dict()
        data["id"] = doc.id
        recipes.append(data)
    return recipes

def delete_recipe(recipe_id):
    """Deletes a recipe from Firestore."""
    db.collection("recipes").document(recipe_id).delete()
    return True

def update_recipe(recipe_id, recipe_data):
    """Updates an existing recipe."""
    db.collection("recipes").document(recipe_id).set(recipe_data, merge=True)
    return True

# --- GOOGLE CLOUD STORAGE ---

def upload_image_to_gcs(image_bytes, destination_blob_name):
    """Uploads an image to Google Cloud Storage and returns the Public URL."""
    storage_client = gcs_storage.Client(project=PROJECT_ID)
    bucket = storage_client.bucket(BUCKET_NAME)
    blob = bucket.blob(destination_blob_name)
    blob.upload_from_string(image_bytes, content_type="image/jpeg")
    return f"https://storage.googleapis.com/{BUCKET_NAME}/{destination_blob_name}"

# --- AI FUNCTIONS ---

def extract_recipe_from_image(image_bytes, mime_type="image/jpeg"):
    """Sends image to Gemini and returns clean JSON string."""
    try:
        model = genai.GenerativeModel("gemini-2.5-flash")
        
        image_part = {
            "mime_type": mime_type,
            "data": image_bytes
        }

        response = model.generate_content(
            [
                image_part,
                """
                Extract the recipe from this image as JSON.
                
                CRITICAL INSTRUCTION:
                1. "ingredients": Return a simple list of strings for display (e.g., "1 cup flour").
                2. "structured_ingredients": Parse each ingredient into clean data parts.
                   - qty: numeric string (e.g. "1", "0.5") or null.
                   - unit: standard unit (cup, tbsp, oz, g) or null.
                   - item: the ingredient name (e.g. "flour", "onion"). Omit terms like "chopped" or 
                   "peeled" which are superfluous when shopping for the item. (Likewise, do not omit
                   any modifiers which would be relevant when shopping, e.g. "pickled" or "frozen".)
                
                Follow this schema exactly:
                {
                    "title": "Recipe Title",
                    "ingredients": ["1 cup flour", "2 eggs"],
                    "structured_ingredients": [
                        {"qty": "1", "unit": "cup", "item": "flour"},
                        {"qty": "2", "unit": null, "item": "eggs"}
                    ],
                    "instructions": ["Mix ingredients", "Bake at 350"],
                    "tags": ["breakfast", "baking"],
                    "source": {
                        "type": "book",
                        "title": "Book Title (or 'Unknown')",
                        "page": 0
                    }
                }
                """
            ]
        )
        
        text = response.text
        match = re.search(r"(\{.*\})", text, re.DOTALL)
        if match:
            return match.group(1)
        else:
            return json.dumps({
                "title": "Error Parsing Recipe", 
                "ingredients": [], 
                "instructions": ["Could not read text from image."]
            })
            
    except Exception as e:
        print(f"Gemini Error: {e}")
        return json.dumps({
            "title": "AI Error",
            "ingredients": [],
            "instructions": [str(e)]
        })

def extract_recipe_from_url(url):
    """Downloads HTML from a URL and uses Gemini to extract the recipe."""
    try:
        # --- STEALTH MODE HEADERS ---
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Accept-Language': 'en-US,en;q=0.9',
            'Referer': 'https://www.google.com/'
        }
        
        print(f"Scraping URL: {url}...")
        response = requests.get(url, headers=headers, timeout=10)
        
        if response.status_code != 200:
            return json.dumps({
                "title": f"Failed to Import (Status {response.status_code})",
                "ingredients": [],
                "instructions": ["The website blocked the importer."],
                "source": {"url": url}
            })

        html_content = response.text[:40000] 
        
        # Use genai
        model = genai.GenerativeModel("gemini-2.0-flash")
        prompt = f"""
        You are a recipe parser. Extract the recipe data from this HTML.
        
        Rules:
        1. Find the TITLE, INGREDIENTS list, and INSTRUCTIONS list.
        2. IGNORE ads, comments, navigation menus, and blog stories.
        3. If you find an image URL (jpg/png/webp), put it in "original_image_url".
        
        Return valid JSON strictly following this schema:
        {{
            "title": "Recipe Title",
            "ingredients": ["1 cup flour", "2 eggs"],
            "structured_ingredients": [
                 {{"qty": "1", "unit": "cup", "item": "flour"}}
            ],
            "instructions": ["Step 1...", "Step 2..."],
            "tags": ["tag1", "tag2"],
            "original_image_url": "http://image-url...",
            "source": {{
                "type": "website",
                "title": "Website Name",
                "url": "{url}"
            }}
        }}

        HTML Content:
        {html_content}
        """
        
        response = model.generate_content(prompt)
        
        text = response.text
        match = re.search(r"(\{.*\})", text, re.DOTALL)
        if match:
            return match.group(1)
        else:
            return json.dumps({"title": "AI Parsing Error", "ingredients": [], "instructions": ["Could not parse JSON."]})
        
    except Exception as e:
        print(f"Error scraping URL: {e}")
        return json.dumps({
            "title": "Import Error",
            "ingredients": [],
            "instructions": [str(e)],
            "source": {"url": url}
        })

# --- SHOPPING LIST ---

def add_ingredients_to_tasks(recipe_title, ingredients):
    """Adds ingredients to a 'Shopping List' task list."""
    print(f"Attempting to add to tasks: {recipe_title}")
    
    try:
        # Reconstruct credentials using the Refresh Token
        creds = Credentials(
            None, 
            refresh_token=TASKS_REFRESH_TOKEN,
            token_uri="https://oauth2.googleapis.com/token",
            client_id=TASKS_CLIENT_ID,
            client_secret=TASKS_CLIENT_SECRET
        )
        
        service = build('tasks', 'v1', credentials=creds)
        
        # 1. Find or create 'Shopping List'
        results = service.tasklists().list().execute()
        items = results.get('items', [])
        
        shopping_list_id = None
        for item in items:
            if item['title'] == 'Shopping List':
                shopping_list_id = item['id']
                break
        
        if not shopping_list_id:
            print("Creating new Shopping List...")
            new_list = service.tasklists().insert(body={'title': 'Shopping List'}).execute()
            shopping_list_id = new_list['id']
        
        # 2. Add items
        for ingredient in ingredients:
            service.tasks().insert(
                tasklist=shopping_list_id,
                body={
                    'title': ingredient,
                    'notes': f"From recipe: {recipe_title}"
                }
            ).execute()
            
        print("Successfully added to tasks.")
        return True

    except Exception as e:
        print(f"Error adding to tasks: {e}")
        # We print the error but return False so the app doesn't crash
        return False