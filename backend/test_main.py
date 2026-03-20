from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock
from main import app, verify_editor 
import json

client = TestClient(app)

# --- SECURITY OVERRIDE (The Fix!) ---
# This tells FastAPI: "When running tests, skip the real Google check.
# Just pretend the user is valid and let them in."
async def fake_verify_editor():
    return "test-user@example.com"

app.dependency_overrides[verify_editor] = fake_verify_editor

# --- 1. HEALTH CHECK ---
def test_read_root():
    """Test that the root serves the Frontend (HTML) or API."""
    response = client.get("/")
    assert response.status_code == 200
    # Since we serve the React app now, we expect HTML, not JSON.
    # We just check that we got a successful response.
    assert "text/html" in response.headers["content-type"]

# --- 2. GET LIST OF RECIPES ---
@patch("services.fetch_all_recipes")
def test_get_recipes(mock_fetch):
    mock_fetch.return_value = [
        {"id": "1", "title": "Test Cake", "ingredients": ["Flour", "Sugar"]},
        {"id": "2", "title": "Test Soup", "ingredients": ["Water", "Carrots"]}
    ]
    response = client.get("/recipes")
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 2
    assert data[0]["title"] == "Test Cake"

# --- 3. SAVE RECIPE ---
@patch("services.save_recipe_to_db")
@patch("services.upload_image_to_gcs")
def test_create_recipe_with_file(mock_upload, mock_save):
    mock_upload.return_value = "http://fake-url.com/img.jpg"
    mock_save.side_effect = lambda data: {**data, "id": "new-id-123"}
    
    recipe_data = {"title": "File Recipe", "ingredients": ["Dough"]}
    
    response = client.post(
        "/recipes",
        data={"recipe": json.dumps(recipe_data)},
        files={"file": ("test.jpg", b"fake-bytes", "image/jpeg")}
    )
    
    assert response.status_code == 200
    data = response.json()
    assert data["title"] == "File Recipe"
    assert data["original_image_url"] == "http://fake-url.com/img.jpg"

# --- 4. DELETE RECIPE (Fixed) ---
@patch("services.delete_recipe")
def test_delete_recipe(mock_delete):
    mock_delete.return_value = True
    response = client.delete("/recipes/123")
    assert response.status_code == 200
    # Fixed: Match the actual API response
    assert response.json() == {"message": "Recipe deleted"} 

# --- 5. DELETE NON-EXISTENT RECIPE ---
@patch("services.delete_recipe")
def test_delete_non_existent_recipe(mock_delete):
    mock_delete.return_value = True 
    response = client.delete("/recipes/99999")
    assert response.status_code == 200

# --- 6. UPDATE RECIPE (Fixed Copy-Paste Error) ---
@patch("services.update_recipe")
def test_update_recipe(mock_update):
    mock_update.return_value = True
    
    update_data = {
        "title": "Updated Title",
        "ingredients": ["New Ingredient"]
    }
    
    response = client.put("/recipes/123", json=update_data)
    
    assert response.status_code == 200
    assert response.json() == {"message": "Recipe updated successfully"}
    mock_update.assert_called_with("123", update_data)

# --- 7. IMPORT FROM URL (Now with 100% less real database usage) ---
@patch("services.extract_recipe_from_url")
@patch("services.save_recipe_to_db")
def test_import_from_url(mock_save, mock_extract):
    """Test the stealth URL import feature."""
    # 1. Mock the Scraper
    fake_json = json.dumps({
        "title": "Web Soup",
        "ingredients": ["Broth"],
        "instructions": ["Boil"],
        "source": {"url": "http://soup.com"}
    })
    mock_extract.return_value = fake_json

    # 2. Mock the Saver (Prevent real DB writes)
    # We make it return the data it was given, plus a fake ID
    mock_save.side_effect = lambda data: {**data, "id": "web-999"}
    
    response = client.post("/import-url", json={"url": "http://soup.com"})
    
    assert response.status_code == 200
    data = response.json()
    assert data["title"] == "Web Soup"
    assert data["id"] == "web-999"
    
    # Verify both were called
    mock_extract.assert_called_with("http://soup.com")
    assert mock_save.called

# --- 8. MANUALLY ADD RECIPE ---
@patch("services.save_recipe_to_db")
def test_create_manual_recipe(mock_save):
    mock_save.side_effect = lambda data: {**data, "id": "manual-id-456"}
    
    recipe_data = {
        "title": "Manual Pasta",
        "ingredients": ["Pasta", "Water"],
        "source": {"type": "personal"}
    }
    
    response = client.post(
        "/recipes",
        data={"recipe": json.dumps(recipe_data)}
    )
    
    assert response.status_code == 200
    data = response.json()
    assert data["title"] == "Manual Pasta"

# --- 9. ADD TO SHOPPING LIST ---
@patch("services.add_ingredients_to_tasks")
def test_add_shopping_list(mock_add_tasks):
    mock_add_tasks.return_value = True
    
    payload = {
        "title": "Tacos",
        "ingredients": ["Shells", "Beef", "Cheese"]
    }
    
    response = client.post("/shopping-list", json=payload)
    
    # If this fails with 422, it means main.py isn't using the Pydantic model correctly
    response = client.post("/shopping-list", json=payload)
    
    # --- ADD THIS DEBUG BLOCK ---
    if response.status_code == 422:
        print("\nAPI REJECTION REASON:")
        print(response.json())
    # ----------------------------

    assert response.status_code == 200
    assert response.json() == {"status": "success"}
    mock_add_tasks.assert_called_with("Tacos", ["Shells", "Beef", "Cheese"])

# --- 10. PHOTO MANAGEMENT (Upload to existing recipe) ---
@patch("services.upload_image_to_gcs")
@patch("services.update_recipe")
def test_upload_recipe_image(mock_update, mock_upload):
    """Test uploading a photo to an existing recipe."""
    # Mock return values
    mock_upload.return_value = "https://fake-url.com/new-image.jpg"
    mock_update.return_value = True

    # Simulate a file upload
    response = client.post(
        "/recipes/recipe-123/image",
        files={"file": ("new_pic.jpg", b"fake-image-bytes", "image/jpeg")}
    )

    # Note: We expect 200 because our security override (fake_verify_editor) 
    # lets us bypass the Google Login check.
    assert response.status_code == 200
    assert response.json() == {"url": "https://fake-url.com/new-image.jpg"}
    
    # Verify the database update was called
    mock_update.assert_called_with("recipe-123", {"original_image_url": "https://fake-url.com/new-image.jpg"})