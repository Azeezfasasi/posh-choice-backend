const Blog = require('../models/Blog');
const cloudinary = require('cloudinary').v2;

const STATUSES = ['draft', 'published'];
const isAdminRequest = (req) => Boolean(req.user && req.user.isAdmin);

const uploadBlogImage = async (file) => {
  const result = await cloudinary.uploader.upload(
    `data:${file.mimetype};base64,${file.buffer.toString('base64')}`,
    { folder: 'poshchoice/blog', resource_type: 'image' }
  );
  return result.secure_url;
};

// FormData sends categories as a string ("a,b"), JSON as an array
const parseCategories = (categories) => {
  if (categories === undefined) return undefined;
  if (Array.isArray(categories)) return categories;
  return String(categories).split(',').map(c => c.trim()).filter(Boolean);
};

// Create a new blog post
exports.createBlog = async (req, res) => {
  try {
    const { title, content, categories, status } = req.body;
    if (!title || !content) return res.status(400).json({ error: 'Title and content are required.' });
    if (status && !STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status.' });
    const image = req.file ? await uploadBlogImage(req.file) : undefined;
    const blog = await Blog.create({
      title,
      content,
      author: req.user.id,
      categories: parseCategories(categories),
      image,
      status: status || 'draft',
      publishedAt: status === 'published' ? new Date() : undefined,
    });
    res.status(201).json(blog);
  } catch (err) {
    console.error('Failed to create blog:', err);
    res.status(500).json({ error: 'Failed to create blog' });
  }
};

// Get all blogs (optionally filter by status/category). The public only sees published posts.
exports.getBlogs = async (req, res) => {
  try {
    const { status, category } = req.query;
    let filter = {};
    if (!isAdminRequest(req)) filter.status = 'published';
    else if (status) filter.status = status;
    if (category) filter.categories = String(category);
    const blogs = await Blog.find(filter).populate('author', 'name').sort({ createdAt: -1 });
    res.json(blogs);
  } catch (err) {
    console.error('Failed to fetch blogs:', err);
    res.status(500).json({ error: 'Failed to fetch blogs' });
  }
};

// Get a single blog post by ID
exports.getBlogById = async (req, res) => {
  try {
    const blog = await Blog.findById(req.params.id).populate('author', 'name');
    if (!blog || (blog.status !== 'published' && !isAdminRequest(req))) {
      return res.status(404).json({ error: 'Blog not found' });
    }
    res.json(blog);
  } catch (err) {
    if (err.name === 'CastError') return res.status(404).json({ error: 'Blog not found' });
    console.error('Failed to fetch blog:', err);
    res.status(500).json({ error: 'Failed to fetch blog' });
  }
};

// Edit a blog post
exports.editBlog = async (req, res) => {
  try {
    const { title, content, categories, status } = req.body;
    if (status && !STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status.' });
    const existing = await Blog.findById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Blog not found' });

    if (title !== undefined) existing.title = title;
    if (content !== undefined) existing.content = content;
    if (categories !== undefined) existing.categories = parseCategories(categories);
    if (req.file) existing.image = await uploadBlogImage(req.file);
    if (status) {
      // Only stamp publishedAt the first time a post goes live
      if (status === 'published' && existing.status !== 'published') existing.publishedAt = new Date();
      existing.status = status;
    }
    const blog = await existing.save();
    res.json(blog);
  } catch (err) {
    console.error('Failed to edit blog:', err);
    res.status(500).json({ error: 'Failed to edit blog' });
  }
};

// Delete a blog post
exports.deleteBlog = async (req, res) => {
  try {
    const blog = await Blog.findByIdAndDelete(req.params.id);
    if (!blog) return res.status(404).json({ error: 'Blog not found' });
    res.json({ message: 'Blog deleted' });
  } catch (err) {
    console.error('Failed to delete blog:', err);
    res.status(500).json({ error: 'Failed to delete blog' });
  }
};

// Change blog status (draft/publish)
exports.changeStatus = async (req, res) => {
  try {
    const { status } = req.body;
    if (!STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status.' });
    const blog = await Blog.findById(req.params.id);
    if (!blog) return res.status(404).json({ error: 'Blog not found' });
    if (status === 'published' && blog.status !== 'published') blog.publishedAt = new Date();
    blog.status = status;
    await blog.save();
    res.json(blog);
  } catch (err) {
    console.error('Failed to change blog status:', err);
    res.status(500).json({ error: 'Failed to change status' });
  }
};

// Get all unique categories (of published posts)
exports.getCategories = async (req, res) => {
  try {
    const categories = await Blog.distinct('categories', { status: 'published' });
    res.json(categories);
  } catch (err) {
    console.error('Failed to fetch blog categories:', err);
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
};
