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

def extract_recipe_from_images(images):
    """
    Sends one or more images to Gemini and returns a clean JSON string.
    images: list of (bytes, content_type) tuples.
    """
    try:
        model = genai.GenerativeModel("gemini-2.5-flash")

        image_parts = [{"mime_type": ct, "data": data} for data, ct in images]
        multi_page = len(images) > 1

        dish_photo_field = ""
        dish_photo_instruction = ""
        if multi_page:
            dish_photo_field = '\n                    "dish_photo_index": null,'
            dish_photo_instruction = """
                7. "dish_photo_index": If one of the images is primarily a photo of the
                   finished dish (not recipe text), set this to its 0-based index (e.g. 0
                   for the first image). Set to null if no such photo is present."""

        prompt = f"""
                Extract the recipe from {"these " + str(len(images)) + " pages" if multi_page else "this image"} as JSON.
                {"Combine all pages into a single complete recipe." if multi_page else ""}

                CRITICAL INSTRUCTIONS:
                1. "ingredients": Return a simple list of strings for display (e.g., "1 cup flour").
                2. "structured_ingredients": Parse each ingredient into clean data parts.
                   - qty: numeric string (e.g. "1", "0.5") or null.
                   - unit: standard unit (cup, tbsp, oz, g) or null.
                   - item: the ingredient name (e.g. "flour", "onion"). Omit terms like "chopped" or
                   "peeled" which are superfluous when shopping for the item. (Likewise, do not omit
                   any modifiers which would be relevant when shopping, e.g. "pickled" or "frozen".)
                3. "prep_time": hands-on preparation time (e.g. "20 mins"). null if not found.
                4. "cook_time": passive cooking time — oven, simmering, etc. (e.g. "45 mins"). null if none.
                5. "total_time": total time from start to finish (e.g. "1 hr 5 mins"). null if not found.
                6. "servings": number of servings as a number or range (e.g. "4" or "4-6"). null if not found.{dish_photo_instruction}

                Follow this schema exactly:
                {{
                    "title": "Recipe Title",
                    "ingredients": ["1 cup flour", "2 eggs"],
                    "structured_ingredients": [
                        {{"qty": "1", "unit": "cup", "item": "flour"}},
                        {{"qty": "2", "unit": null, "item": "eggs"}}
                    ],
                    "instructions": ["Mix ingredients", "Bake at 350"],
                    "tags": ["breakfast", "baking"],
                    "prep_time": "20 mins",
                    "cook_time": "45 mins",
                    "total_time": "1 hr 5 mins",
                    "servings": "4",{dish_photo_field}
                    "source": {{
                        "type": "book",
                        "title": "Book Title (or 'Unknown')",
                        "page": 0
                    }}
                }}
                """

        response = model.generate_content(image_parts + [prompt])
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
        4. Extract prep_time, cook_time, total_time, and servings if present.
           - prep_time: hands-on preparation time (e.g. "20 mins")
           - cook_time: passive cooking time — oven, simmering, etc. (e.g. "45 mins")
           - total_time: total time start to finish (e.g. "1 hr 5 mins")
           - servings: serving count or range (e.g. "4" or "4-6")
           Use null for any that are not found.

        Return valid JSON strictly following this schema:
        {{
            "title": "Recipe Title",
            "ingredients": ["1 cup flour", "2 eggs"],
            "structured_ingredients": [
                 {{"qty": "1", "unit": "cup", "item": "flour"}}
            ],
            "instructions": ["Step 1...", "Step 2..."],
            "tags": ["tag1", "tag2"],
            "prep_time": "20 mins",
            "cook_time": "45 mins",
            "total_time": "1 hr 5 mins",
            "servings": "4",
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


# --- OUR GROCERIES ---

async def add_to_our_groceries(recipe_title, ingredients):
    """Adds ingredients to the user's Our Groceries shopping list."""
    email = os.environ.get("OUR_GROCERIES_EMAIL")
    password = os.environ.get("OUR_GROCERIES_PASSWORD")
    if not email or not password:
        print("Our Groceries credentials not configured (set OUR_GROCERIES_EMAIL and OUR_GROCERIES_PASSWORD)")
        return False

    try:
        from ourgroceries import OurGroceries
        og = OurGroceries(email, password)
        await og.login()

        lists_data = await og.get_my_lists()
        shopping_lists = lists_data.get("shoppingLists", [])

        if not shopping_lists:
            print("No shopping lists found in Our Groceries account")
            return False

        # Prefer a list matching OUR_GROCERIES_LIST_NAME env var; otherwise use the first list
        list_name = os.environ.get("OUR_GROCERIES_LIST_NAME", "")
        target = None
        if list_name:
            target = next((l for l in shopping_lists if l["name"].lower() == list_name.lower()), None)
        if not target:
            target = shopping_lists[0]

        list_id = target["id"]
        for ingredient in ingredients:
            await og.add_item_to_list(list_id, ingredient, auto_category=True)

        print(f"Added {len(ingredients)} items to Our Groceries list '{target['name']}'")
        return True

    except Exception as e:
        print(f"Our Groceries error: {e}")
        return False


# --- TIME / SERVINGS EXTRACTION ---

def extract_times_for_recipe(recipe):
    """Uses Gemini to estimate cook times and servings from a recipe's text."""
    try:
        model = genai.GenerativeModel("gemini-2.0-flash")
        title = recipe.get("title", "")
        ingredients = "\n".join(recipe.get("ingredients", []))
        instructions = "\n".join(recipe.get("instructions", []))

        prompt = f"""Given this recipe, estimate the cooking times and serving size.

Recipe title: {title}
Ingredients:
{ingredients}
Instructions:
{instructions}

Return ONLY a JSON object with this exact structure (no markdown, no extra text):
{{
    "prep_time": "20 mins",
    "cook_time": "45 mins",
    "total_time": "1 hr 5 mins",
    "servings": "4"
}}

Guidelines:
- prep_time: hands-on preparation time
- cook_time: passive cooking time (oven, simmering, marinating, etc.) — null if there is none
- total_time: total elapsed time from start to finish
- servings: number of servings as a simple number or range (e.g. "4" or "4-6")
- Use common abbreviations: "mins", "hr", "hrs"
- If you genuinely cannot estimate a value, use null"""

        response = model.generate_content(prompt)
        match = re.search(r"\{.*\}", response.text, re.DOTALL)
        if match:
            return json.loads(match.group(0))
        return None
    except Exception as e:
        print(f"Error extracting times for '{recipe.get('title')}': {e}")
        return None