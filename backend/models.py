from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime

class RecipeSource(BaseModel):
    # Make everything optional so it doesn't crash if data is partial
    type: Optional[str] = "book" 
    title: Optional[str] = "Unknown Source"
    page: Optional[int] = None
    url: Optional[str] = None

class RecipeBase(BaseModel):
    title: str
    # validation often fails if these are None instead of empty lists
    ingredients: List[str] = [] 
    instructions: List[str] = []
    tags: List[str] = []
    source: Optional[RecipeSource] = None

class RecipeCreate(RecipeBase):
    pass

class Recipe(RecipeBase):
    id: str
    original_image_url: Optional[str] = None
    created_at: Optional[str] = None