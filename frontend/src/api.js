import axios from 'axios';

const API_URL = ""; 

// --- AUTH TOKEN MANAGEMENT ---
let authToken = null;

export const setAuthToken = (token) => {
    authToken = token;
    if (token) {
        localStorage.setItem("token", token); 
    } else {
        localStorage.removeItem("token");
    }
};

// Helper to create headers with the token
const getHeaders = (multipart = false) => {
    const headers = {};
    
    // FIX: This now matches the key we set above ("token")
    const token = authToken || localStorage.getItem("token"); 

    if (token) {
        headers["Authorization"] = `Bearer ${token}`;
    }
    
    if (multipart) {
        headers["Content-Type"] = "multipart/form-data";
    }
    return headers;
};

// --- RECIPE API FUNCTIONS ---

export const fetchRecipes = async () => {
  const response = await axios.get(`${API_URL}/recipes`);
  return response.data;
};

export const createRecipe = async (recipeData) => {
    // 1. Clean the data
    const payload = { ...recipeData };
    delete payload.id;
    delete payload.original_image_url;
    
    // 2. BACKEND COMPATIBILITY MODE 🛠️
    // The backend expects a Multipart Form because it used to handle file uploads.
    // We must send the data as a stringified JSON inside a form field named "recipe".
    const formData = new FormData();
    formData.append("recipe", JSON.stringify(payload));
    
    // 3. Send as Multipart Form (getHeaders(true))
    const response = await axios.post(`${API_URL}/recipes`, formData, {
        headers: getHeaders(true) // true triggers multipart/form-data
    });
    return response.data;
};

export const updateRecipe = async (id, recipeData) => {
    const payload = { ...recipeData };
    delete payload.id;
    delete payload.original_image_url;
  
    const response = await axios.put(`${API_URL}/recipes/${id}`, payload, {
        headers: getHeaders()
    });
    return response.data;
};

export const deleteRecipe = async (id) => {
  const response = await axios.delete(`${API_URL}/recipes/${id}`, {
      headers: getHeaders() 
  });
  return response.data;
};

export const importFromUrl = async (url) => {
  const response = await axios.post(`${API_URL}/import-url`, { url: url }, {
      headers: getHeaders()
  });
  return response.data;
};

export const addToShoppingList = async (title, ingredients) => {
  // Send as a plain JSON object. Axios will automatically stringify the list correctly.
  const response = await axios.post(`${API_URL}/shopping-list`, {
    title: title, 
    ingredients: ingredients
  }, {
      headers: getHeaders() // Standard JSON headers
  });
  return response.data;
};

export const uploadRecipeImage = async (recipeId, file) => {
    const formData = new FormData();
    formData.append("file", file);
    
    // Uses the helper to attach auth headers
    const response = await axios.post(`${API_URL}/recipes/${recipeId}/image`, formData, {
        headers: getHeaders(true) // true = multipart/form-data
    });
    return response.data;
    //    return response.data.url;
};

export const deleteRecipeImage = async (recipeId) => {
    const response = await axios.delete(`${API_URL}/recipes/${recipeId}/image`, {
        headers: getHeaders()
    });
    return response.data;
};

export const starRecipe = async (id, starred) => {
    const response = await axios.put(`${API_URL}/recipes/${id}/star`, { starred }, {
        headers: getHeaders()
    });
    return response.data;
};

export const triggerExtractTimes = async () => {
    const response = await axios.post(`${API_URL}/admin/extract-times`, {}, {
        headers: getHeaders()
    });
    return response.data;
};

export const analyzeImages = async (files) => {
    const formData = new FormData();
    for (const file of files) {
        formData.append("files", file);
    }
    const response = await axios.post(`${API_URL}/analyze`, formData, {
        headers: getHeaders(true)
    });
    return response.data;
};